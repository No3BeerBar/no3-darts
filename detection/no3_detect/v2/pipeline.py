"""v2 multi-camera pipeline: board-plane fusion + takeout + API."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import yaml
from rich.console import Console

from ..api_client import No3Client
from .board_plane import BoardPoint, fuse_board_points
from .cam_calib import CamCalib
from .tip_detect import TipConfig, TipDetector, TipResult

console = Console()


@dataclass
class V2Config:
    no3_api_url: str = "http://localhost:3000"
    camera_api_key: str = ""
    room_id: str = "Board 1"
    debounce_ms: int = 1600
    min_confidence: float = 0.45
    preview: bool = True
    dry_run: bool = False
    hand_motion_pixels: int = 8000
    cameras: List[Dict[str, Any]] = field(default_factory=list)

    @staticmethod
    def load(path: str | Path) -> "V2Config":
        raw = yaml.safe_load(Path(path).read_text()) or {}
        known = set(V2Config.__dataclass_fields__.keys())
        return V2Config(**{k: v for k, v in raw.items() if k in known})


@dataclass
class CamRT:
    id: str
    cap: cv2.VideoCapture
    calib: CamCalib
    det: TipDetector


class V2Pipeline:
    def __init__(self, config: V2Config):
        self.config = config
        self.client = No3Client(
            config.no3_api_url,
            api_key=config.camera_api_key,
            room_id=config.room_id,
        )
        self.cams: List[CamRT] = []
        self._last_post = 0.0
        self.darts_visit = 0
        self.waiting_takeout = False
        self._hand_streak = 0

    def open(self) -> None:
        for cam in self.config.cameras:
            if not cam.get("enabled", True):
                continue
            cid = cam["id"]
            source = cam["source"]
            if isinstance(source, str) and source.isdigit():
                source = int(source)
            path = cam.get("calibration")
            if not path or not Path(path).exists():
                console.print(f"[yellow]Skip {cid}: missing {path} — run v2-calibrate[/yellow]")
                continue
            # v2 only
            try:
                raw = Path(path).read_text()
                if '"version": 2' not in raw and "H_image_to_board" not in raw:
                    console.print(
                        f"[yellow]Skip {cid}: not v2 calib — run scripts\\calibrate-auto-v2.bat[/yellow]"
                    )
                    continue
                calib = CamCalib.load(path)
            except Exception as e:
                console.print(f"[red]{cid} calib load failed: {e}[/red]")
                continue
            if isinstance(source, int):
                cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
                if not cap.isOpened():
                    cap = cv2.VideoCapture(source)
            else:
                cap = cv2.VideoCapture(source)
            if not cap.isOpened():
                console.print(f"[red]Cannot open {cid}[/red]")
                continue
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            for _ in range(6):
                cap.read()
            det = TipDetector(calib, TipConfig())
            ok, frame = cap.read()
            if ok:
                det.reset_background(frame)
            self.cams.append(CamRT(id=cid, cap=cap, calib=calib, det=det))
            console.print(f"[green]v2 opened {cid}[/green]")
        if not self.cams:
            raise RuntimeError(
                "No v2 cameras. Run: scripts\\calibrate-auto-v2.bat  "
                "(or: python -m no3_detect v2-auto-calibrate --cameras 0 1 2 -y)"
            )

    def close(self) -> None:
        for c in self.cams:
            c.cap.release()
        cv2.destroyAllWindows()

    def run(self) -> None:
        self.open()
        console.rule("[bold]No3 detection v2[/bold]")
        console.print(f"API {self.client.base_url}  room={self.config.room_id}")
        console.print("Board-plane fusion (Autodarts/DeepDarts style)")
        console.print("Keys: B=empty bg  N=next visit  Q=quit")
        try:
            self.client.health()
            console.print("[green]API health OK[/green]")
        except Exception as e:
            console.print(f"[yellow]API: {e}[/yellow]")

        last_hb = 0.0
        try:
            while True:
                tips: List[TipResult] = []
                frames: Dict[str, Any] = {}
                max_f2f = 0
                for cam in self.cams:
                    ok, frame = cam.cap.read()
                    if not ok:
                        continue
                    frames[cam.id] = frame
                    res, overlay = cam.det.process(frame)
                    max_f2f = max(max_f2f, cam.det.last_f2f)
                    phase = "TAKEOUT" if self.waiting_takeout else f"THROW {self.darts_visit}/3"
                    cv2.putText(
                        overlay,
                        phase,
                        (10, overlay.shape[0] - 20),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (0, 200, 255) if self.waiting_takeout else (0, 255, 0),
                        2,
                    )
                    if self.config.preview:
                        cv2.imshow(f"v2 · {cam.id}", overlay)
                    if cam.det.last_event:
                        console.print(f"[dim]{cam.id}[/dim] {cam.det.last_event}")
                        cam.det.last_event = ""
                    if res is not None and not self.waiting_takeout:
                        tips.append(res)

                if tips and not self.waiting_takeout:
                    fused = fuse_board_points([t.board for t in tips])
                    if fused and fused.confidence >= self.config.min_confidence:
                        self._post(fused)

                if self.waiting_takeout:
                    if max_f2f >= self.config.hand_motion_pixels:
                        self._hand_streak += 1
                    else:
                        if self._hand_streak >= 3 and max_f2f < self.config.hand_motion_pixels // 4:
                            self._finish_takeout(frames)
                        self._hand_streak = 0

                now = time.time()
                if now - last_hb >= 2:
                    last_hb = now
                    console.print(
                        f"[dim]v2 live visit={self.darts_visit}/3 "
                        f"takeout={self.waiting_takeout} f2f={max_f2f}[/dim]"
                    )

                if self.config.preview:
                    key = cv2.waitKey(1) & 0xFF
                    if key == ord("q"):
                        break
                    if key == ord("b"):
                        for cam in self.cams:
                            ok, frame = cam.cap.read()
                            if ok:
                                cam.det.reset_background(frame)
                        console.print("[blue]Background locked (empty board)[/blue]")
                    if key == ord("n"):
                        self._finish_takeout(frames)
                else:
                    time.sleep(0.01)
        finally:
            self.close()

    def _post(self, bp: BoardPoint) -> None:
        now = time.time() * 1000
        if now - self._last_post < self.config.debounce_ms:
            return
        hit = bp.to_hit()
        try:
            resp = self.client.post_dart(hit, dry_run=self.config.dry_run)
            self._last_post = now
            self.darts_visit += 1
            console.print(
                f"[bold green]POST[/bold green] {hit.kind} {hit.number} "
                f"board=({bp.x:.2f},{bp.y:.2f}) conf={bp.confidence:.2f} "
                f"visit={self.darts_visit}/3"
            )
            turn_ended = bool(resp.get("turnEnded")) if isinstance(resp, dict) else False
            if self.darts_visit >= 3 or turn_ended:
                self.waiting_takeout = True
                self._hand_streak = 0
                console.print(
                    "[yellow]VISIT FULL — remove darts (or press N)[/yellow]"
                )
        except Exception as e:
            console.print(f"[red]POST failed: {e}[/red]")

    def _finish_takeout(self, frames: Dict[str, Any]) -> None:
        console.print("[blue]Takeout → next visit[/blue]")
        try:
            self.client.end_turn(dry_run=self.config.dry_run)
        except Exception as e:
            console.print(f"[dim]end-turn: {e}[/dim]")
        for cam in self.cams:
            frame = frames.get(cam.id)
            if frame is None:
                ok, frame = cam.cap.read()
                if not ok:
                    continue
            cam.det.reset_background(frame)
        self.darts_visit = 0
        self.waiting_takeout = False
        self._hand_streak = 0
        console.print("[green]READY[/green]")
