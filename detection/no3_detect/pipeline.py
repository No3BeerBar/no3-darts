"""
Multi-camera detection pipeline + visit takeout + API publish.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import yaml
from rich.console import Console

from .api_client import No3Client
from .board_geometry import SegmentHit, fuse_hits
from .calibration import BoardCalibration
from .motion_detector import DetectorConfig, DetectionResult, MotionDartDetector
from .turn_flow import PendingCandidate, VisitController, VisitPhase

console = Console()


@dataclass
class CameraRuntime:
    id: str
    source: Any
    cap: cv2.VideoCapture
    detector: MotionDartDetector
    calib: BoardCalibration


@dataclass
class PipelineConfig:
    no3_api_url: str = "http://localhost:3000"
    camera_api_key: str = ""
    room_id: str = "Board 1"
    debounce_ms: int = 1800
    min_confidence: float = 0.55
    motion_threshold: int = 10
    min_blob_area: int = 20
    max_blob_area: int = 12000  # hands are huge — reject big blobs as darts
    settle_frames: int = 5
    min_motion_pixels: int = 35
    settle_motion_pixels: int = 100
    spike_motion_pixels: int = 200
    max_pending_frames: int = 30
    # Consensus: same segment must be seen this many times before POST
    confirm_hits: int = 2
    confirm_window_ms: int = 900
    # Reject tip too close to last scored tip (same dart re-fire)
    min_tip_separation_px: float = 18.0
    # Hand / takeout thresholds (frame-to-frame pixels, scaled later)
    hand_motion_pixels: int = 2500
    # Board nearly empty vs empty snapshot (fraction of ROI change)
    empty_board_fg_max: int = 80
    # After takeout motion, quiet frames before ending visit
    takeout_quiet_frames: int = 8
    # Min time in takeout before allowing empty-board auto-advance
    takeout_min_ms: int = 400
    preview: bool = True
    show_mask: bool = True
    dry_run: bool = False
    cameras: List[Dict[str, Any]] = field(default_factory=list)

    @staticmethod
    def load(path: str | Path) -> "PipelineConfig":
        raw = yaml.safe_load(Path(path).read_text()) or {}
        known = set(PipelineConfig.__dataclass_fields__.keys())
        data = {k: v for k, v in raw.items() if k in known}
        return PipelineConfig(**data)


class DetectionPipeline:
    def __init__(self, config: PipelineConfig):
        self.config = config
        self.client = No3Client(
            config.no3_api_url,
            api_key=config.camera_api_key,
            room_id=config.room_id,
        )
        self.cameras: List[CameraRuntime] = []
        self._last_post_ms = 0.0
        self.visit = VisitController()
        self._det_cfg = DetectorConfig(
            motion_threshold=config.motion_threshold,
            min_blob_area=config.min_blob_area,
            max_blob_area=config.max_blob_area,
            settle_frames=config.settle_frames,
            min_motion_pixels=config.min_motion_pixels,
            settle_motion_pixels=config.settle_motion_pixels,
            spike_motion_pixels=config.spike_motion_pixels,
            max_pending_frames=config.max_pending_frames,
            show_mask=config.show_mask,
        )

    def open_cameras(self) -> None:
        for cam in self.config.cameras:
            if not cam.get("enabled", True):
                continue
            cid = cam["id"]
            source = cam["source"]
            if isinstance(source, str) and source.isdigit():
                source = int(source)
            calib_path = cam.get("calibration")
            if not calib_path or not Path(calib_path).exists():
                console.print(
                    f"[yellow]Skip {cid}: missing calibration {calib_path}[/yellow]"
                )
                continue
            calib = BoardCalibration.load(calib_path)
            calib.camera_id = cid
            if isinstance(source, int):
                cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
                if not cap.isOpened():
                    cap.release()
                    cap = cv2.VideoCapture(source)
            else:
                cap = cv2.VideoCapture(source)
            if not cap.isOpened():
                console.print(f"[red]Could not open camera {cid} source={source}[/red]")
                continue
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            for _ in range(8):
                cap.read()
            det = MotionDartDetector(calib, self._det_cfg)
            ok, frame = cap.read()
            if ok:
                h, w = frame.shape[:2]
                det.reset_background(frame)
                console.print(
                    f"[green]Opened {cid} ← {source}[/green]  "
                    f"{w}x{h}  calib center=({calib.center_x:.0f},{calib.center_y:.0f}) "
                    f"R={calib.radius_px:.0f}"
                )
                if calib.radius_px < 30:
                    console.print(
                        f"[red]{cid}: radius only {calib.radius_px:.0f}px — re-calibrate[/red]"
                    )
            else:
                console.print(f"[red]{cid}: opened but cannot read frames[/red]")
                cap.release()
                continue
            self.cameras.append(
                CameraRuntime(
                    id=cid, source=source, cap=cap, detector=det, calib=calib
                )
            )

        if not self.cameras:
            raise RuntimeError(
                "No cameras opened. Need calib\\camN.json for each camera and working USB cams."
            )

    def close(self) -> None:
        for c in self.cameras:
            c.cap.release()
        cv2.destroyAllWindows()

    def _reset_all_backgrounds(self, frames: Dict[str, Any]) -> None:
        for cam in self.cameras:
            frame = frames.get(cam.id)
            if frame is None:
                ok, frame = cam.cap.read()
                if not ok:
                    continue
            cam.detector.reset_background(frame)

    def _max_f2f(self) -> int:
        return max((c.detector._last_frame_motion for c in self.cameras), default=0)

    def _max_fg_vs_empty(self) -> int:
        """How much board differs from last empty-board B snapshot."""
        best = 0
        for cam in self.cameras:
            d = cam.detector
            if d._bg_empty is None or d._prev_gray is None:
                best = max(best, d._last_fg_pixels)
                continue
            # quick fg vs empty using last gray if shapes match
            try:
                th, fg = d._fg_mask(d._prev_gray, d._bg_empty)
                best = max(best, fg)
            except Exception:
                best = max(best, d._last_fg_pixels)
        return best

    def _handle_detection(
        self,
        results: List[DetectionResult],
        now_ms: float,
    ) -> None:
        """Accuracy gate + consensus before POST."""
        if self.visit.phase != VisitPhase.THROWING:
            return
        if not results:
            return

        # Fuse multi-cam same-frame votes
        hits = [r.hit for r in results]
        fused = fuse_hits(hits, min_confidence=self.config.min_confidence * 0.85)
        if fused is None:
            return

        # Pick tip from the result that matches fused segment
        tip = None
        for r in results:
            if r.hit.kind == fused.kind and r.hit.number == fused.number:
                tip = r.tip_xy
                break
        if tip is None:
            tip = results[0].tip_xy

        # Reject miss / outside unless high conf
        if fused.kind == "miss" and fused.confidence < 0.75:
            console.print("[dim]skip miss (low conf)[/dim]")
            return

        # Reject if tip nearly same as last scored dart
        if self.visit.last_tip is not None and tip is not None:
            dx = tip[0] - self.visit.last_tip[0]
            dy = tip[1] - self.visit.last_tip[1]
            if math.hypot(dx, dy) < self.config.min_tip_separation_px:
                console.print("[dim]skip re-detect same tip[/dim]")
                return

        # Reject geometric nonsense (radius way outside board)
        if fused.radius > 1.12 and fused.kind != "miss":
            console.print(f"[dim]skip r={fused.radius:.2f} outside board[/dim]")
            return

        # Confidence floor — no more "post anyway"
        if fused.confidence < self.config.min_confidence:
            console.print(
                f"[yellow]skip low conf {fused.kind} {fused.number} "
                f"({fused.confidence:.2f} < {self.config.min_confidence})[/yellow]"
            )
            return

        # Consensus: need confirm_hits of same segment within window
        key = (fused.kind, fused.number)
        cand = self.visit.candidate
        if (
            cand is None
            or (cand.hit.kind, cand.hit.number) != key
            or now_ms - cand.last_ms > self.config.confirm_window_ms
        ):
            self.visit.candidate = PendingCandidate(
                hit=fused,
                tip_xy=tip or (0.0, 0.0),
                count=1,
                first_ms=now_ms,
                last_ms=now_ms,
            )
            console.print(
                f"[dim]candidate {fused.kind} {fused.number} "
                f"1/{self.config.confirm_hits} conf={fused.confidence:.2f}[/dim]"
            )
        else:
            cand.count += 1
            cand.last_ms = now_ms
            cand.hit = fused
            if tip:
                cand.tip_xy = tip
            console.print(
                f"[dim]candidate {fused.kind} {fused.number} "
                f"{cand.count}/{self.config.confirm_hits}[/dim]"
            )

        need = self.config.confirm_hits
        # Multi-cam same frame: accept immediately
        if len(results) >= 2:
            need = 1
        if self.visit.candidate and self.visit.candidate.count >= need:
            self._maybe_post(
                self.visit.candidate.hit, self.visit.candidate.tip_xy, now_ms
            )

    def _maybe_post(
        self,
        hit: SegmentHit,
        tip: Optional[Tuple[float, float]],
        now_ms: float,
    ) -> None:
        if now_ms - self._last_post_ms < self.config.debounce_ms:
            console.print("[dim]debounced[/dim]")
            return
        if self.visit.darts_this_visit >= 3:
            return
        try:
            resp = self.client.post_dart(hit, dry_run=self.config.dry_run)
            self._last_post_ms = now_ms
            self.visit.note_posted(hit, tip, now_ms)
            callout = resp.get("callout") if isinstance(resp, dict) else None
            turn_ended = bool(resp.get("turnEnded")) if isinstance(resp, dict) else False
            turn = resp.get("currentTurnDarts") if isinstance(resp, dict) else None
            n_turn = len(turn) if isinstance(turn, list) else self.visit.darts_this_visit
            console.print(
                f"[bold green]POST OK[/bold green] {hit.kind} {hit.number} "
                f"conf={hit.confidence:.2f} callout={callout!r} "
                f"visit={self.visit.darts_this_visit}/3 server_turn={n_turn}"
            )
            if turn_ended or self.visit.darts_this_visit >= 3 or n_turn == 0:
                if self.visit.phase != VisitPhase.WAIT_TAKEOUT:
                    self.visit.enter_takeout(now_ms)
                console.print(
                    "[bold yellow]VISIT COMPLETE — remove darts "
                    "(hands in board → next). Scoring paused.[/bold yellow]"
                )
        except Exception as e:
            console.print(f"[red]POST failed: {e}[/red]")

    def _process_takeout(self, now_ms: float, frames: Dict[str, Any]) -> None:
        """Hands / clear board → end turn if needed + reset for next visit."""
        f2f = self._max_f2f()
        fg_empty = self._max_fg_vs_empty()
        hand_thr = self.config.hand_motion_pixels

        if f2f >= hand_thr:
            self.visit.saw_hand_motion = True
            self.visit.takeout_motion_streak += 1
            self.visit.takeout_quiet_streak = 0
        else:
            self.visit.takeout_quiet_streak += 1
            self.visit.takeout_motion_streak = 0

        elapsed = now_ms - self.visit.phase_entered_ms
        board_clear = fg_empty <= self.config.empty_board_fg_max
        hands_done = (
            self.visit.saw_hand_motion
            and self.visit.takeout_quiet_streak >= self.config.takeout_quiet_frames
        )
        empty_done = (
            board_clear
            and elapsed >= self.config.takeout_min_ms
            and self.visit.takeout_quiet_streak >= self.config.takeout_quiet_frames
        )

        if hands_done or empty_done:
            why = "hands" if hands_done else "board empty"
            console.print(f"[bold blue]TAKEOUT detected ({why}) — next visit[/bold blue]")
            try:
                resp = self.client.end_turn(dry_run=self.config.dry_run)
                console.print(f"[green]end-turn OK[/green] {resp.get('callout') if isinstance(resp, dict) else resp}")
            except Exception as e:
                # Server may already have advanced after 3 darts — that's fine
                console.print(f"[dim]end-turn: {e}[/dim]")
            self._reset_all_backgrounds(frames)
            self.visit.reset_visit()
            console.print(
                "[bold green]READY — empty board locked. Throw next visit.[/bold green]"
            )

    def _watch_mid_visit_takeout(self, now_ms: float, frames: Dict[str, Any]) -> None:
        """If hands pull darts before 3 scored, end turn early."""
        if self.visit.phase != VisitPhase.THROWING:
            return
        if self.visit.darts_this_visit <= 0:
            return
        f2f = self._max_f2f()
        if f2f < self.config.hand_motion_pixels:
            self._mid_hand_streak = 0
            return
        # Sustained big motion = arm/hand in frame
        self._mid_hand_streak += 1
        if self._mid_hand_streak < 5:
            return
        self._mid_hand_streak = 0
        console.print(
            f"[bold yellow]HANDS mid-visit after {self.visit.darts_this_visit} dart(s) "
            f"— ending turn[/bold yellow]"
        )
        try:
            resp = self.client.end_turn(dry_run=self.config.dry_run)
            console.print(f"[green]end-turn OK[/green] {resp.get('callout') if isinstance(resp, dict) else resp}")
        except Exception as e:
            console.print(f"[red]end-turn failed: {e}[/red]")
        self.visit.enter_takeout(now_ms)
        # Stay in takeout until board settles empty
        self.visit.saw_hand_motion = True

    def run(self) -> None:
        self.open_cameras()
        console.print()
        console.rule("[bold]No3 detector[/bold]")
        console.print(
            f"API  → [cyan]{self.client.base_url}[/cyan]  "
            f"POST [cyan]{self.client.dart_url}[/cyan]"
        )
        console.print(
            f"room=[cyan]{self.config.room_id}[/cyan]  "
            f"min_conf={self.config.min_confidence}  "
            f"confirm={self.config.confirm_hits}x"
        )
        console.print()
        console.print("[bold]Visit flow (Autodarts-style)[/bold]")
        console.print("  • Score up to 3 darts")
        console.print("  • Then PAUSE — pull darts (hands) → next player / next visit")
        console.print("  • Hands mid-visit also end the turn early")
        console.print("  Keys: [bold]B[/bold]=empty lock  [bold]N[/bold]=force next visit  "
                      "[bold]T[/bold]=force detect  [bold]Q[/bold]=quit")
        console.print()

        try:
            self.client.health()
            console.print("[green]API health OK[/green]")
        except Exception as e:
            console.print(f"[yellow]API health failed: {e}[/yellow]")

        try:
            active = self.client.active_match()
            if active:
                console.print(f"[green]Active match[/green] id={active.get('id', '?')}")
            else:
                console.print("[yellow]No active match — start a game on the iPad[/yellow]")
        except Exception as e:
            console.print(f"[dim]active match check: {e}[/dim]")

        last_heartbeat = 0.0
        self._mid_hand_streak = 0
        try:
            while True:
                now_ms = time.time() * 1000
                frame_results: List[DetectionResult] = []
                frames: Dict[str, Any] = {}

                for cam in self.cameras:
                    ok, frame = cam.cap.read()
                    if not ok:
                        continue
                    frames[cam.id] = frame

                    if self.visit.phase == VisitPhase.THROWING:
                        result, overlay = cam.detector.process(frame)
                    else:
                        # Still process for motion stats, but discard dart hits
                        result, overlay = cam.detector.process(frame)
                        result = None

                    # Phase banner on overlay
                    phase = self.visit.phase.value
                    color = (0, 200, 255) if phase == "wait_takeout" else (0, 255, 0)
                    cv2.putText(
                        overlay,
                        f"{phase.upper()}  darts={self.visit.darts_this_visit}/3",
                        (10, overlay.shape[0] - 36),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        color,
                        2,
                    )

                    if self.config.preview:
                        cv2.imshow(f"No3 · {cam.id}", overlay)
                        if self.config.show_mask and cam.detector._last_mask is not None:
                            cv2.imshow(f"Mask · {cam.id}", cam.detector._last_mask)

                    ev = cam.detector._last_event
                    if ev:
                        console.print(f"[dim]{cam.id}[/dim] {ev}")
                        cam.detector._last_event = ""

                    if result is not None:
                        console.print(
                            f"[cyan]DETECT {cam.id}[/cyan] → "
                            f"{result.hit.kind} {result.hit.number} "
                            f"conf={result.hit.confidence:.2f} "
                            f"r={result.hit.radius:.2f}"
                        )
                        frame_results.append(result)

                if self.visit.phase == VisitPhase.THROWING:
                    self._handle_detection(frame_results, now_ms)
                    self._watch_mid_visit_takeout(now_ms, frames)
                else:
                    self._process_takeout(now_ms, frames)

                now = time.time()
                if now - last_heartbeat >= 2.0:
                    last_heartbeat = now
                    parts = [
                        f"{c.id}:fg={c.detector._last_fg_pixels}"
                        f"/f2f={c.detector._last_frame_motion}"
                        for c in self.cameras
                    ]
                    console.print(
                        f"[dim]live {self.visit.phase.value} "
                        f"{self.visit.darts_this_visit}/3 | {' | '.join(parts)}[/dim]"
                    )

                if self.config.preview:
                    key = cv2.waitKey(1) & 0xFF
                    if key == ord("q"):
                        break
                    if key == ord("b"):
                        self._reset_all_backgrounds(frames)
                        console.print(
                            "[bold blue]B: empty board locked[/bold blue]"
                        )
                    if key == ord("n"):
                        # Force next visit (manual takeout)
                        console.print("[bold blue]N: force next visit[/bold blue]")
                        try:
                            self.client.end_turn(dry_run=self.config.dry_run)
                        except Exception as e:
                            console.print(f"[dim]end-turn: {e}[/dim]")
                        self._reset_all_backgrounds(frames)
                        self.visit.reset_visit()
                    if key == ord("t") and self.visit.phase == VisitPhase.THROWING:
                        console.print("[magenta]T: force detect[/magenta]")
                        force_results: List[DetectionResult] = []
                        for cam in self.cameras:
                            frame = frames.get(cam.id)
                            if frame is None:
                                continue
                            result, overlay = cam.detector.force_detect(frame)
                            if self.config.preview:
                                cv2.imshow(f"No3 · {cam.id}", overlay)
                            if result is not None:
                                force_results.append(result)
                                console.print(
                                    f"[magenta]{cam.id}[/magenta] {cam.detector._last_event}"
                                )
                        # Force path: single confirm
                        old = self.config.confirm_hits
                        self.config.confirm_hits = 1
                        self._handle_detection(force_results, now_ms)
                        self.config.confirm_hits = old
                    if key == ord("d"):
                        self.config.dry_run = not self.config.dry_run
                        console.print(f"[blue]dry_run={self.config.dry_run}[/blue]")
                else:
                    time.sleep(0.01)
        finally:
            self.close()
