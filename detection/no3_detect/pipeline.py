"""
Multi-camera detection pipeline + debounce + API publish.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import yaml
from rich.console import Console

from .api_client import No3Client
from .board_geometry import SegmentHit, fuse_hits
from .calibration import BoardCalibration
from .motion_detector import DetectorConfig, MotionDartDetector

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
    debounce_ms: int = 1200
    min_confidence: float = 0.30
    motion_threshold: int = 8
    min_blob_area: int = 10
    max_blob_area: int = 80000
    settle_frames: int = 3
    min_motion_pixels: int = 25
    settle_motion_pixels: int = 80
    spike_motion_pixels: int = 150
    max_pending_frames: int = 25
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
            # Prefer a stable resolution if the cam allows it
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
                        f"[red]{cid}: radius only {calib.radius_px:.0f}px — "
                        f"re-calibrate (circle must cover the board)[/red]"
                    )
                if not (0 <= calib.center_x < w and 0 <= calib.center_y < h):
                    console.print(
                        f"[red]{cid}: center outside frame — re-calibrate[/red]"
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

    def _handle_hits(self, frame_hits: List[SegmentHit]) -> None:
        if not frame_hits:
            return
        fused = fuse_hits(frame_hits, min_confidence=0.2)
        if fused is None:
            console.print(f"[dim]hits ignored (low conf): {len(frame_hits)} cam(s)[/dim]")
        elif fused.confidence < self.config.min_confidence:
            console.print(
                f"[yellow]hit below min_confidence "
                f"({fused.confidence:.2f} < {self.config.min_confidence}) "
                f"→ {fused.kind} {fused.number} — posting anyway for debug[/yellow]"
            )
            # Still post while debugging sensitivity — better to score wrong than never
            self._maybe_post(fused)
        else:
            self._maybe_post(fused)

    def run(self) -> None:
        self.open_cameras()
        console.print()
        console.rule("[bold]No3 detector[/bold]")
        console.print(
            f"API  → [cyan]{self.config.no3_api_url}[/cyan]  "
            f"room=[cyan]{self.config.room_id}[/cyan]  "
            f"dry_run={self.config.dry_run}"
        )
        console.print(
            f"Sensitivity → thr={self.config.motion_threshold}  "
            f"min_fg={self.config.min_motion_pixels}  "
            f"min_conf={self.config.min_confidence}"
        )
        console.print()
        console.print("[bold]=== READ THIS ===[/bold]")
        console.print(
            "[bold yellow]THIS black window[/bold yellow] is the console (logs print here)."
        )
        console.print("Camera windows are separate video previews.")
        console.print()
        console.print("[bold]Manual test (works even if auto-detect fails):[/bold]")
        console.print("  1. Click a [bold]camera[/bold] window (not this black one)")
        console.print("  2. Empty board → press [bold]B[/bold]")
        console.print("  3. Stick a dart in the board by hand")
        console.print("  4. Press [bold]T[/bold]  (force detect)")
        console.print("  You should see FORCE HIT / POST dart in THIS window.")
        console.print()
        console.print("Keys: [bold]B[/bold]=empty bg  [bold]T[/bold]=force detect  "
                      "[bold]D[/bold]=dry-run  [bold]Q[/bold]=quit")
        console.print()

        try:
            self.client.health()
            console.print("[green]API health OK[/green]")
        except Exception as e:
            console.print(f"[yellow]API health failed (will still detect): {e}[/yellow]")

        try:
            active = self.client.active_match()
            if active:
                console.print(
                    f"[green]Active match found[/green] id={active.get('id', '?')}"
                )
            else:
                console.print(
                    "[yellow]No active match on server — darts may post but UI won't score "
                    "until you start a game on the iPad for this room.[/yellow]"
                )
        except Exception as e:
            console.print(f"[dim]Could not check active match: {e}[/dim]")

        last_heartbeat = 0.0
        try:
            while True:
                frame_hits: List[SegmentHit] = []
                frames: Dict[str, Any] = {}

                for cam in self.cameras:
                    ok, frame = cam.cap.read()
                    if not ok:
                        console.print(f"[red]{cam.id}: camera read failed[/red]")
                        continue
                    frames[cam.id] = frame
                    result, overlay = cam.detector.process(frame)
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
                            f"[bold cyan]DETECT {cam.id}[/bold cyan] → "
                            f"{result.hit.kind} {result.hit.number} "
                            f"conf={result.hit.confidence:.2f} "
                            f"tip=({result.tip_xy[0]:.0f},{result.tip_xy[1]:.0f})"
                        )
                        frame_hits.append(result.hit)

                self._handle_hits(frame_hits)

                now = time.time()
                if now - last_heartbeat >= 2.0:
                    last_heartbeat = now
                    parts = []
                    for cam in self.cameras:
                        d = cam.detector
                        parts.append(
                            f"{cam.id}:fg={d._last_fg_pixels}/{d._scaled_min_fg}"
                            f" f2f={d._last_frame_motion}"
                            f"{'*' if d._pending else ''}"
                        )
                    console.print(f"[dim]live {' | '.join(parts)}[/dim]")

                if self.config.preview:
                    key = cv2.waitKey(1) & 0xFF
                    if key == ord("q"):
                        break
                    if key == ord("b"):
                        for cam in self.cameras:
                            ok, frame = cam.cap.read()
                            if not ok and cam.id in frames:
                                frame = frames[cam.id]
                                ok = True
                            if ok:
                                cam.detector.reset_background(frame)
                        console.print(
                            "[bold blue]B: background locked — board must be EMPTY[/bold blue]"
                        )
                    if key == ord("t"):
                        # Force-detect on every camera using current frame
                        console.print(
                            "[bold magenta]T: force detect (dart should already be in board)[/bold magenta]"
                        )
                        force_hits: List[SegmentHit] = []
                        for cam in self.cameras:
                            ok, frame = cam.cap.read()
                            if not ok and cam.id in frames:
                                frame = frames[cam.id]
                                ok = True
                            if not ok:
                                continue
                            result, overlay = cam.detector.force_detect(frame)
                            if self.config.preview:
                                cv2.imshow(f"No3 · {cam.id}", overlay)
                                if cam.detector._last_mask is not None:
                                    cv2.imshow(
                                        f"Mask · {cam.id}", cam.detector._last_mask
                                    )
                            ev = cam.detector._last_event
                            if ev:
                                console.print(f"[magenta]{cam.id}[/magenta] {ev}")
                                cam.detector._last_event = ""
                            if result is not None:
                                force_hits.append(result.hit)
                        self._handle_hits(force_hits)
                    if key == ord("d"):
                        self.config.dry_run = not self.config.dry_run
                        console.print(f"[blue]dry_run={self.config.dry_run}[/blue]")
                    if key == ord("h"):
                        console.print(
                            "Keys: B=empty board  T=force detect  D=dry-run  Q=quit"
                        )
                else:
                    time.sleep(0.01)
        finally:
            self.close()

    def _maybe_post(self, hit: SegmentHit) -> None:
        now = time.time() * 1000
        if now - self._last_post_ms < self.config.debounce_ms:
            console.print("[dim]debounced[/dim]")
            return
        try:
            resp = self.client.post_dart(hit, dry_run=self.config.dry_run)
            self._last_post_ms = now
            callout = resp.get("callout") if isinstance(resp, dict) else None
            turn = resp.get("currentTurnDarts") if isinstance(resp, dict) else None
            n_turn = len(turn) if isinstance(turn, list) else "?"
            console.print(
                f"[bold green]POST OK[/bold green] {hit.kind} {hit.number} "
                f"callout={callout!r} turn_darts={n_turn} match={resp.get('matchId') if isinstance(resp, dict) else '?'}"
            )
            console.print(
                "[dim]iPad/TV should update within ~1s if a match is open for this room[/dim]"
            )
        except Exception as e:
            console.print(f"[red]POST failed: {e}[/red]")
