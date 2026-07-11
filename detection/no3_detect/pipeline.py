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


@dataclass
class PipelineConfig:
    no3_api_url: str = "http://localhost:3000"
    camera_api_key: str = ""
    room_id: str = "Board 1"
    debounce_ms: int = 1200
    min_confidence: float = 0.45
    motion_threshold: int = 18
    min_blob_area: int = 25
    max_blob_area: int = 25000
    settle_frames: int = 6
    min_motion_pixels: int = 80
    preview: bool = True
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
                    f"[yellow]Skip {cid}: missing calibration {calib_path}. "
                    f"Run: python -m no3_detect calibrate --camera {source} --id {cid}[/yellow]"
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
            # warm-up
            for _ in range(5):
                cap.read()
            det = MotionDartDetector(calib, self._det_cfg)
            ok, frame = cap.read()
            if ok:
                det.reset_background(frame)
            self.cameras.append(
                CameraRuntime(id=cid, source=source, cap=cap, detector=det)
            )
            console.print(f"[green]Opened {cid} ← {source}[/green]")

        if not self.cameras:
            raise RuntimeError("No cameras opened. Calibrate at least one camera first.")

    def close(self) -> None:
        for c in self.cameras:
            c.cap.release()
        cv2.destroyAllWindows()

    def run(self) -> None:
        self.open_cameras()
        console.print(
            f"[bold]No3 detector running[/bold] → {self.config.no3_api_url} "
            f"room={self.config.room_id} dry_run={self.config.dry_run}"
        )
        try:
            self.client.health()
            console.print("[green]API health OK[/green]")
        except Exception as e:
            console.print(f"[yellow]API health failed (will still detect): {e}[/yellow]")

        try:
            while True:
                frame_hits: List[SegmentHit] = []
                for cam in self.cameras:
                    ok, frame = cam.cap.read()
                    if not ok:
                        continue
                    result, overlay = cam.detector.process(frame)
                    if self.config.preview:
                        cv2.imshow(f"No3 · {cam.id}", overlay)
                    if result is not None:
                        console.print(
                            f"[cyan]{cam.id}[/cyan] → {result.hit.kind} "
                            f"{result.hit.number} conf={result.hit.confidence:.2f}"
                        )
                        frame_hits.append(result.hit)

                if frame_hits:
                    fused = fuse_hits(frame_hits, min_confidence=0.3)
                    if fused is None:
                        console.print(f"[dim]hits ignored (low conf): {len(frame_hits)} cam(s)[/dim]")
                    elif fused.confidence < self.config.min_confidence:
                        console.print(
                            f"[yellow]hit below min_confidence "
                            f"({fused.confidence:.2f} < {self.config.min_confidence}) "
                            f"→ {fused.kind} {fused.number}[/yellow]"
                        )
                    else:
                        self._maybe_post(fused)

                if self.config.preview:
                    key = cv2.waitKey(1) & 0xFF
                    if key == ord("q"):
                        break
                    if key == ord("b"):
                        # force background reset (empty board)
                        for cam in self.cameras:
                            ok, frame = cam.cap.read()
                            if ok:
                                cam.detector.reset_background(frame)
                        console.print("[blue]Background reset — board should be EMPTY[/blue]")
                    if key == ord("d"):
                        # toggle dry-run logging help
                        self.config.dry_run = not self.config.dry_run
                        console.print(f"[blue]dry_run={self.config.dry_run}[/blue]")
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
            console.print(f"[bold green]POST dart[/bold green] {hit.kind} {hit.number} → {resp}")
        except Exception as e:
            console.print(f"[red]POST failed: {e}[/red]")
