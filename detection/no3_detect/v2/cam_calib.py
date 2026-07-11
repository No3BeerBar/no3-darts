"""Per-camera 4-point homography calibration (DeepDarts / Autodarts style)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, List, Optional, Tuple

import cv2
import numpy as np

from .board_plane import ideal_calib_points


@dataclass
class CamCalib:
    camera_id: str
    # Image points corresponding to ideal_calib_points() order (20,6,3,11 outer double)
    image_points: List[List[float]]
    image_width: int = 0
    image_height: int = 0
    # Cached 3x3 board→image and image→board
    H_board_to_image: Optional[List[List[float]]] = None
    H_image_to_board: Optional[List[List[float]]] = None
    version: int = 2

    def __post_init__(self) -> None:
        if self.H_board_to_image is None or self.H_image_to_board is None:
            self.recompute_H()

    def recompute_H(self) -> None:
        if len(self.image_points) < 4:
            raise ValueError("Need 4 image calibration points")
        dst = np.float32(ideal_calib_points())  # board
        src = np.float32(self.image_points[:4])  # image
        # image → board
        H_ib, _ = cv2.findHomography(src, dst, method=0)
        if H_ib is None:
            raise RuntimeError("Homography failed — points may be collinear")
        H_bi = np.linalg.inv(H_ib)
        self.H_image_to_board = H_ib.tolist()
        self.H_board_to_image = H_bi.tolist()

    def image_to_board(self, u: float, v: float) -> Tuple[float, float]:
        H = np.asarray(self.H_image_to_board, dtype=np.float64)
        p = H @ np.array([u, v, 1.0], dtype=np.float64)
        if abs(p[2]) < 1e-9:
            return 99.0, 99.0
        return float(p[0] / p[2]), float(p[1] / p[2])

    def board_to_image(self, x: float, y: float) -> Tuple[float, float]:
        H = np.asarray(self.H_board_to_image, dtype=np.float64)
        p = H @ np.array([x, y, 1.0], dtype=np.float64)
        if abs(p[2]) < 1e-9:
            return 0.0, 0.0
        return float(p[0] / p[2]), float(p[1] / p[2])

    def draw_overlay(self, frame_bgr: np.ndarray) -> np.ndarray:
        """Draw ideal board projected onto image for visual check."""
        import math

        vis = frame_bgr.copy()
        pts = []
        for i in range(72):
            a = math.radians(i * 5)
            bx, by = math.sin(a), math.cos(a)
            u, v = self.board_to_image(bx, by)
            pts.append((int(round(u)), int(round(v))))
        for i in range(len(pts)):
            cv2.line(vis, pts[i], pts[(i + 1) % len(pts)], (0, 200, 255), 2)
        # treble ring ~0.6
        tpts = []
        for i in range(72):
            a = math.radians(i * 5)
            bx, by = 0.605 * math.sin(a), 0.605 * math.cos(a)
            u, v = self.board_to_image(bx, by)
            tpts.append((int(round(u)), int(round(v))))
        for i in range(len(tpts)):
            cv2.line(vis, tpts[i], tpts[(i + 1) % len(tpts)], (80, 80, 200), 1)
        u, v = self.board_to_image(0.0, 0.0)
        cv2.circle(vis, (int(round(u)), int(round(v))), 6, (0, 255, 0), -1)
        u2, v2 = self.board_to_image(0.0, 1.0)
        cv2.line(
            vis,
            (int(round(u)), int(round(v))),
            (int(round(u2)), int(round(v2))),
            (0, 255, 0),
            2,
        )
        cv2.putText(
            vis,
            "20",
            (int(round(u2)) + 6, int(round(v2))),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 0),
            2,
        )
        for i, (ix, iy) in enumerate(self.image_points[:4]):
            cv2.circle(vis, (int(ix), int(iy)), 7, (0, 255, 255), 2)
            cv2.putText(
                vis,
                str(i + 1),
                (int(ix) + 8, int(iy) - 8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 255),
                2,
            )
        return vis

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2))

    @staticmethod
    def load(path: str | Path) -> "CamCalib":
        data: dict[str, Any] = json.loads(Path(path).read_text())
        # only v2 fields
        return CamCalib(
            camera_id=data["camera_id"],
            image_points=data["image_points"],
            image_width=data.get("image_width", 0),
            image_height=data.get("image_height", 0),
            H_board_to_image=data.get("H_board_to_image"),
            H_image_to_board=data.get("H_image_to_board"),
            version=data.get("version", 2),
        )
