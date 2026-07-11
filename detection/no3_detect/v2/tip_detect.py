"""Background-difference tip detection → image pixel → board plane via CamCalib."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np

from .board_plane import BoardPoint
from .cam_calib import CamCalib


@dataclass
class TipConfig:
    motion_threshold: int = 12
    min_blob_area: int = 20
    max_blob_area: int = 15000
    min_fg_pixels: int = 40
    settle_f2f_pixels: int = 100
    settle_frames: int = 4
    max_pending: int = 35


@dataclass
class TipResult:
    board: BoardPoint
    tip_uv: Tuple[float, float]
    fg_pixels: int


class TipDetector:
    def __init__(self, calib: CamCalib, config: Optional[TipConfig] = None):
        self.calib = calib
        self.cfg = config or TipConfig()
        self._bg: Optional[np.ndarray] = None
        self._bg_frozen: Optional[np.ndarray] = None
        self._prev: Optional[np.ndarray] = None
        self._pending = False
        self._quiet = 0
        self._streak = 0
        self.last_fg = 0
        self.last_f2f = 0
        self.last_event = ""

    def reset_background(self, frame_bgr: np.ndarray) -> None:
        g = self._gray(frame_bgr)
        self._bg = g.astype(np.float32)
        self._bg_frozen = None
        self._prev = g.copy()
        self._pending = False
        self._quiet = 0
        self._streak = 0
        self.last_event = "bg_reset"

    def _gray(self, bgr: np.ndarray) -> np.ndarray:
        g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        return cv2.GaussianBlur(g, (5, 5), 0)

    def process(self, frame_bgr: np.ndarray) -> Tuple[Optional[TipResult], np.ndarray]:
        self.last_event = ""
        g = self._gray(frame_bgr)
        overlay = frame_bgr.copy()
        cfg = self.cfg

        if self._bg is None:
            self.reset_background(frame_bgr)
            return None, self.calib.draw_overlay(overlay)

        bg = cv2.convertScaleAbs(self._bg)
        diff = cv2.absdiff(g, bg)
        _, th = cv2.threshold(diff, cfg.motion_threshold, 255, cv2.THRESH_BINARY)
        th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        fg = int(np.count_nonzero(th))
        self.last_fg = fg

        if self._prev is not None:
            fdiff = cv2.absdiff(g, self._prev)
            _, fth = cv2.threshold(fdiff, max(6, cfg.motion_threshold - 2), 255, cv2.THRESH_BINARY)
            f2f = int(np.count_nonzero(fth))
        else:
            f2f = 0
        self._prev = g.copy()
        self.last_f2f = f2f

        new_obj = fg >= cfg.min_fg_pixels
        moving = f2f >= cfg.settle_f2f_pixels

        if new_obj and not self._pending:
            self._bg_frozen = self._bg.copy() if self._bg is not None else None
            self._pending = True
            self._quiet = 0
            self._streak = 1
            self.last_event = f"motion fg={fg}"
        elif self._pending:
            self._streak += 1
            if moving:
                self._quiet = 0
            else:
                self._quiet += 1
        else:
            if fg < cfg.min_fg_pixels // 2:
                cv2.accumulateWeighted(g, self._bg, 0.005)

        result: Optional[TipResult] = None
        if self._pending and (
            self._quiet >= cfg.settle_frames or self._streak >= cfg.max_pending
        ):
            # Measure tip vs pre-throw background
            ref = self._bg_frozen if self._bg_frozen is not None else self._bg
            if ref is not None:
                ref_u8 = cv2.convertScaleAbs(ref)
                diff2 = cv2.absdiff(g, ref_u8)
                _, th2 = cv2.threshold(
                    diff2, max(8, cfg.motion_threshold - 2), 255, cv2.THRESH_BINARY
                )
                th2 = cv2.morphologyEx(th2, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
                th2 = cv2.morphologyEx(th2, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
                tip = self._find_tip(th2)
                th = th2
            else:
                tip = self._find_tip(th)
            if tip is not None:
                u, v = tip
                bx, by = self.calib.image_to_board(u, v)
                r = (bx * bx + by * by) ** 0.5
                conf = 0.55
                if r <= 1.05:
                    conf = 0.7
                if r <= 1.0:
                    conf += 0.1
                conf = min(0.95, conf + min(fg, 400) / 2000.0)
                result = TipResult(
                    board=BoardPoint(
                        x=bx, y=by, confidence=conf, camera_id=self.calib.camera_id
                    ),
                    tip_uv=(u, v),
                    fg_pixels=fg,
                )
                self.last_event = f"tip board=({bx:.2f},{by:.2f}) conf={conf:.2f}"
                cv2.circle(overlay, (int(u), int(v)), 10, (0, 255, 255), 2)
                # lock dart into background
                self._bg = g.astype(np.float32)
            else:
                self.last_event = "settle_no_tip"
                cv2.accumulateWeighted(g, self._bg, 0.2)
            self._pending = False
            self._quiet = 0
            self._streak = 0

        # tint + status
        color = cv2.cvtColor(th, cv2.COLOR_GRAY2BGR)
        color[:, :, 0] = 0
        color[:, :, 1] = 0
        overlay = cv2.addWeighted(overlay, 1.0, color, 0.3, 0)
        overlay = self.calib.draw_overlay(overlay)
        cv2.putText(
            overlay,
            f"{self.calib.camera_id} fg={fg} f2f={f2f} pend={int(self._pending)}",
            (10, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 255, 0),
            1,
        )
        return result, overlay

    def _find_tip(self, mask: np.ndarray) -> Optional[Tuple[float, float]]:
        cfg = self.cfg
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None
        # board center in image
        cu, cv_ = self.calib.board_to_image(0.0, 0.0)
        best = None
        best_score = -1.0
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < cfg.min_blob_area or area > cfg.max_blob_area:
                continue
            pts = cnt.reshape(-1, 2).astype(np.float32)
            d = np.hypot(pts[:, 0] - cu, pts[:, 1] - cv_)
            i = int(np.argmin(d))
            tip = (float(pts[i, 0]), float(pts[i, 1]))
            # prefer elongated
            elong = 1.0
            if len(cnt) >= 5:
                try:
                    (_, _), (ma, mi), _ = cv2.fitEllipse(cnt)
                    elong = max(ma, mi) / max(min(ma, mi), 1e-3)
                except cv2.error:
                    pass
            score = (1.0 / (1.0 + d[i] / 200.0)) * min(elong, 5.0) * np.log1p(area)
            if score > best_score:
                best_score = score
                best = tip
        return best
