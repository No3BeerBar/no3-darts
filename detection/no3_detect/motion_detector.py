"""
Frame-difference dart tip detector for a single calibrated camera.

Approach (classic DIY / open-source style):
  1. Keep a running "empty board" background (updated when idle).
  2. When a dart sticks, motion spikes then settles.
  3. Foreground mask → largest elongated blob near the board.
  4. Tip ≈ point on the contour closest to the board center
     (dart points inward from the rim / stands in the sisal).

This is a solid v1. Production bars later add multi-cam triangulation
and optional ML tip refinement.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np

from .board_geometry import SegmentHit
from .calibration import BoardCalibration


@dataclass
class DetectorConfig:
    motion_threshold: int = 28
    min_blob_area: int = 40
    max_blob_area: int = 12000
    settle_frames: int = 4
    bg_learn_rate_idle: float = 0.02
    # Only search inside slightly larger than double wire
    roi_scale: float = 1.12


@dataclass
class DetectionResult:
    hit: SegmentHit
    tip_xy: Tuple[float, float]
    motion_score: float
    camera_id: str


class MotionDartDetector:
    def __init__(self, calib: BoardCalibration, config: Optional[DetectorConfig] = None):
        self.calib = calib
        self.config = config or DetectorConfig()
        self._bg: Optional[np.ndarray] = None
        self._motion_streak = 0
        self._quiet_streak = 0
        self._pending = False
        self._last_motion = 0.0

    def reset_background(self, frame_bgr: np.ndarray) -> None:
        gray = self._prep(frame_bgr)
        self._bg = gray.astype(np.float32)
        self._motion_streak = 0
        self._quiet_streak = 0
        self._pending = False

    def _prep(self, frame_bgr: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        return gray

    def _roi_mask(self, shape: Tuple[int, int]) -> np.ndarray:
        h, w = shape
        mask = np.zeros((h, w), dtype=np.uint8)
        r = int(self.calib.radius_px * self.config.roi_scale)
        cv2.circle(
            mask,
            (int(self.calib.center_x), int(self.calib.center_y)),
            r,
            255,
            -1,
        )
        return mask

    def process(
        self, frame_bgr: np.ndarray
    ) -> Tuple[Optional[DetectionResult], np.ndarray]:
        """
        Process one frame.
        Returns (detection_or_None, debug_overlay_bgr).
        """
        gray = self._prep(frame_bgr)
        overlay = frame_bgr.copy()
        cfg = self.config

        if self._bg is None:
            self._bg = gray.astype(np.float32)
            return None, overlay

        diff = cv2.absdiff(gray, cv2.convertScaleAbs(self._bg))
        roi = self._roi_mask(gray.shape)
        diff = cv2.bitwise_and(diff, diff, mask=roi)
        _, th = cv2.threshold(diff, cfg.motion_threshold, 255, cv2.THRESH_BINARY)
        th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

        motion_score = float(np.mean(th[roi > 0]) / 255.0) if np.any(roi) else 0.0
        self._last_motion = motion_score

        # Draw ROI
        cv2.circle(
            overlay,
            (int(self.calib.center_x), int(self.calib.center_y)),
            int(self.calib.radius_px),
            (80, 80, 80),
            1,
        )

        active = motion_score > 0.002  # any meaningful motion in ROI

        if active:
            self._motion_streak += 1
            self._quiet_streak = 0
            self._pending = True
        else:
            self._quiet_streak += 1
            self._motion_streak = 0
            # slowly adapt background when idle and not pending
            if not self._pending:
                cv2.accumulateWeighted(gray, self._bg, cfg.bg_learn_rate_idle)

        result: Optional[DetectionResult] = None

        # After motion, wait for settle then measure tip against pre-motion bg
        if self._pending and self._quiet_streak >= cfg.settle_frames:
            tip = self._find_tip(th if np.count_nonzero(th) > 0 else diff, gray)
            # Prefer mask from current high-res diff vs frozen bg
            diff2 = cv2.absdiff(gray, cv2.convertScaleAbs(self._bg))
            diff2 = cv2.bitwise_and(diff2, diff2, mask=roi)
            _, th2 = cv2.threshold(diff2, cfg.motion_threshold, 255, cv2.THRESH_BINARY)
            th2 = cv2.morphologyEx(th2, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
            tip = self._find_tip(th2, gray)

            if tip is not None:
                tx, ty = tip
                conf = self._confidence(th2, tip, motion_score)
                hit = self.calib.hit_at_pixel(tx, ty, confidence=conf)
                result = DetectionResult(
                    hit=hit,
                    tip_xy=(tx, ty),
                    motion_score=motion_score,
                    camera_id=self.calib.camera_id,
                )
                cv2.circle(overlay, (int(tx), int(ty)), 8, (0, 255, 255), 2)
                cv2.putText(
                    overlay,
                    f"{hit.kind} {hit.number} ({hit.confidence:.2f})",
                    (int(tx) + 10, int(ty)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 255),
                    2,
                )
                # lock new background including the dart (for next dart)
                self._bg = gray.astype(np.float32)
            else:
                # false motion – keep adapting
                cv2.accumulateWeighted(gray, self._bg, 0.1)

            self._pending = False
            self._quiet_streak = 0

        # debug motion tint
        color_m = cv2.cvtColor(th, cv2.COLOR_GRAY2BGR)
        color_m[:, :, 0] = 0
        color_m[:, :, 1] = 0
        overlay = cv2.addWeighted(overlay, 1.0, color_m, 0.25, 0)
        cv2.putText(
            overlay,
            f"{self.calib.camera_id} motion={motion_score:.3f} pending={self._pending}",
            (10, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (220, 220, 220),
            1,
        )

        return result, overlay

    def _find_tip(
        self, mask_or_diff: np.ndarray, gray: np.ndarray
    ) -> Optional[Tuple[float, float]]:
        cfg = self.config
        if mask_or_diff.ndim == 2 and mask_or_diff.dtype != np.uint8:
            m = cv2.normalize(mask_or_diff, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
            _, m = cv2.threshold(m, cfg.motion_threshold, 255, cv2.THRESH_BINARY)
        else:
            m = mask_or_diff

        contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        cx, cy = self.calib.center_x, self.calib.center_y
        best_tip = None
        best_score = -1.0

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < cfg.min_blob_area or area > cfg.max_blob_area:
                continue
            # Tip heuristic: point on contour nearest to board center
            pts = cnt.reshape(-1, 2).astype(np.float32)
            d = np.hypot(pts[:, 0] - cx, pts[:, 1] - cy)
            i = int(np.argmin(d))
            tip = (float(pts[i, 0]), float(pts[i, 1]))
            # Prefer blobs with some elongation (shaft-like)
            if len(cnt) >= 5:
                (_, _), (ma, mi), _ = cv2.fitEllipse(cnt) if len(cnt) >= 5 else ((0, 0), (1, 1), 0)
                elong = max(ma, mi) / max(min(ma, mi), 1e-3)
            else:
                elong = 1.0
            # score: closer to board, reasonable area, elongated
            r_norm = d[i] / max(self.calib.radius_px, 1)
            if r_norm > 1.15:
                continue
            score = (1.2 - r_norm) * min(elong, 4.0) * np.log1p(area)
            if score > best_score:
                best_score = score
                best_tip = tip

        return best_tip

    def _confidence(
        self, mask: np.ndarray, tip: Tuple[float, float], motion_score: float
    ) -> float:
        area = float(np.count_nonzero(mask))
        # Map area + motion into 0.4–0.95
        a = np.clip(area / 800.0, 0.0, 1.0)
        m = np.clip(motion_score * 20.0, 0.0, 1.0)
        conf = 0.4 + 0.35 * a + 0.25 * m
        # Inside board boost
        r, _ = self.calib.to_polar(tip[0], tip[1])
        if r <= 1.0:
            conf = min(0.98, conf + 0.05)
        return float(conf)
