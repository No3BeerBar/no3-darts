"""
Frame-difference dart tip detector for a single calibrated camera.

Approach (classic DIY / open-source style):
  1. Keep a running "empty board" background (updated when idle).
  2. When a dart sticks, motion spikes then settles.
  3. Foreground mask → largest elongated blob near the board.
  4. Tip ≈ point on the contour closest to the board center
     (dart points inward from the rim / stands in the sisal).
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
    motion_threshold: int = 18  # lower = more sensitive (was 28)
    min_blob_area: int = 25
    max_blob_area: int = 25000
    settle_frames: int = 6
    bg_learn_rate_idle: float = 0.01
    # Only search inside slightly larger than double wire
    roi_scale: float = 1.15
    # Absolute foreground pixel count to treat as motion (NOT mean fraction)
    min_motion_pixels: int = 80


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
        self._bg_frozen: Optional[np.ndarray] = None  # snapshot before motion
        self._motion_streak = 0
        self._quiet_streak = 0
        self._pending = False
        self._last_motion = 0.0
        self._last_fg_pixels = 0

    def reset_background(self, frame_bgr: np.ndarray) -> None:
        gray = self._prep(frame_bgr)
        self._bg = gray.astype(np.float32)
        self._bg_frozen = None
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
            max(r, 10),
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

        bg_u8 = cv2.convertScaleAbs(self._bg)
        diff = cv2.absdiff(gray, bg_u8)
        roi = self._roi_mask(gray.shape)
        diff = cv2.bitwise_and(diff, diff, mask=roi)
        _, th = cv2.threshold(diff, cfg.motion_threshold, 255, cv2.THRESH_BINARY)
        th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

        fg_pixels = int(np.count_nonzero(th))
        self._last_fg_pixels = fg_pixels
        # Fraction only for display
        motion_score = float(np.mean(th[roi > 0]) / 255.0) if np.any(roi) else 0.0
        self._last_motion = motion_score

        # Draw ROI (calibration circle)
        cv2.circle(
            overlay,
            (int(self.calib.center_x), int(self.calib.center_y)),
            int(self.calib.radius_px),
            (80, 80, 80),
            1,
        )
        cv2.circle(
            overlay,
            (int(self.calib.center_x), int(self.calib.center_y)),
            4,
            (0, 255, 0),
            -1,
        )

        # Use ABSOLUTE pixel count — mean fraction is far too small for a dart on HD frames
        active = fg_pixels >= cfg.min_motion_pixels

        if active:
            if not self._pending:
                # Freeze background as of just before this motion burst
                self._bg_frozen = self._bg.copy()
            self._motion_streak += 1
            self._quiet_streak = 0
            self._pending = True
        else:
            self._quiet_streak += 1
            self._motion_streak = 0
            if not self._pending:
                cv2.accumulateWeighted(gray, self._bg, cfg.bg_learn_rate_idle)

        result: Optional[DetectionResult] = None

        # After motion, wait for settle then measure tip vs frozen pre-motion bg
        if self._pending and self._quiet_streak >= cfg.settle_frames:
            ref = self._bg_frozen if self._bg_frozen is not None else self._bg
            ref_u8 = cv2.convertScaleAbs(ref)
            diff2 = cv2.absdiff(gray, ref_u8)
            diff2 = cv2.bitwise_and(diff2, diff2, mask=roi)
            _, th2 = cv2.threshold(diff2, max(10, cfg.motion_threshold - 6), 255, cv2.THRESH_BINARY)
            th2 = cv2.morphologyEx(th2, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
            th2 = cv2.morphologyEx(th2, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            tip = self._find_tip(th2, gray)

            if tip is not None:
                tx, ty = tip
                conf = self._confidence(th2, tip, float(fg_pixels))
                hit = self.calib.hit_at_pixel(tx, ty, confidence=conf)
                result = DetectionResult(
                    hit=hit,
                    tip_xy=(tx, ty),
                    motion_score=motion_score,
                    camera_id=self.calib.camera_id,
                )
                cv2.circle(overlay, (int(tx), int(ty)), 10, (0, 255, 255), 2)
                cv2.putText(
                    overlay,
                    f"{hit.kind} {hit.number} conf={hit.confidence:.2f}",
                    (int(tx) + 10, int(ty)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 255),
                    2,
                )
                # Lock background INCLUDING the dart so next dart is incremental
                self._bg = gray.astype(np.float32)
            else:
                # Motion but no tip — soft adapt, don't fully lock
                cv2.accumulateWeighted(gray, self._bg, 0.15)

            self._pending = False
            self._quiet_streak = 0
            self._bg_frozen = None

        # debug motion tint (red = foreground)
        color_m = cv2.cvtColor(th, cv2.COLOR_GRAY2BGR)
        color_m[:, :, 0] = 0
        color_m[:, :, 1] = 0
        overlay = cv2.addWeighted(overlay, 1.0, color_m, 0.35, 0)
        status = (
            f"{self.calib.camera_id} fg={fg_pixels} thr={cfg.min_motion_pixels} "
            f"pending={self._pending} quiet={self._quiet_streak}"
        )
        cv2.putText(
            overlay,
            status,
            (10, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 255, 0) if active or self._pending else (220, 220, 220),
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
            pts = cnt.reshape(-1, 2).astype(np.float32)
            d = np.hypot(pts[:, 0] - cx, pts[:, 1] - cy)
            i = int(np.argmin(d))
            tip = (float(pts[i, 0]), float(pts[i, 1]))
            if len(cnt) >= 5:
                try:
                    (_, _), (ma, mi), _ = cv2.fitEllipse(cnt)
                    elong = max(ma, mi) / max(min(ma, mi), 1e-3)
                except cv2.error:
                    elong = 1.0
            else:
                elong = 1.0
            r_norm = d[i] / max(self.calib.radius_px, 1)
            if r_norm > 1.2:
                continue
            score = (1.25 - r_norm) * min(elong, 5.0) * np.log1p(area)
            if score > best_score:
                best_score = score
                best_tip = tip

        # Fallback: largest contour centroid if tip heuristic fails
        if best_tip is None and contours:
            cnt = max(contours, key=cv2.contourArea)
            area = cv2.contourArea(cnt)
            if area >= cfg.min_blob_area:
                M = cv2.moments(cnt)
                if M["m00"] > 0:
                    best_tip = (float(M["m10"] / M["m00"]), float(M["m01"] / M["m00"]))

        return best_tip

    def _confidence(
        self, mask: np.ndarray, tip: Tuple[float, float], fg_pixels: float
    ) -> float:
        area = float(np.count_nonzero(mask))
        a = np.clip(area / 600.0, 0.0, 1.0)
        m = np.clip(fg_pixels / 400.0, 0.0, 1.0)
        conf = 0.45 + 0.35 * a + 0.2 * m
        r, _ = self.calib.to_polar(tip[0], tip[1])
        if r <= 1.0:
            conf = min(0.98, conf + 0.05)
        return float(conf)
