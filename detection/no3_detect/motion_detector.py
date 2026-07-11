"""
Frame-difference dart tip detector for a single calibrated camera.

Approach:
  1. Empty-board background (press B to lock).
  2. Start a cycle when bg-diff OR frame-to-frame spike crosses threshold.
  3. Wait until frame-to-frame motion drops (hand gone) OR a short timeout.
  4. Tip = point on new blob closest to board center.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np

from .board_geometry import SegmentHit
from .calibration import BoardCalibration


@dataclass
class DetectorConfig:
    motion_threshold: int = 10  # intensity 0–255
    min_blob_area: int = 20
    max_blob_area: int = 12000  # reject hands/arms (huge blobs)
    settle_frames: int = 5
    bg_learn_rate_idle: float = 0.004
    roi_scale: float = 1.25
    min_motion_pixels: int = 35
    settle_motion_pixels: int = 100
    spike_motion_pixels: int = 200
    max_pending_frames: int = 30
    show_mask: bool = True


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
        # Snapshot from last B press (true empty board) — used by force T
        self._bg_empty: Optional[np.ndarray] = None
        self._bg_frozen: Optional[np.ndarray] = None
        self._prev_gray: Optional[np.ndarray] = None
        self._motion_streak = 0
        self._quiet_streak = 0
        self._pending = False
        self._last_motion = 0.0
        self._last_fg_pixels = 0
        self._last_frame_motion = 0
        self._last_event: str = "init"
        self._last_mask: Optional[np.ndarray] = None
        self._frame_shape: Optional[Tuple[int, int]] = None
        self._scaled_min_fg = self.config.min_motion_pixels
        self._scaled_settle = self.config.settle_motion_pixels
        self._scaled_spike = self.config.spike_motion_pixels

    def reset_background(self, frame_bgr: np.ndarray) -> None:
        gray = self._prep(frame_bgr)
        self._bg = gray.astype(np.float32)
        self._bg_empty = gray.astype(np.float32)  # keep pure empty for force-T
        self._bg_frozen = None
        self._prev_gray = gray.copy()
        self._motion_streak = 0
        self._quiet_streak = 0
        self._pending = False
        self._last_event = "bg_reset"
        self._update_scales(gray.shape)

    def force_detect(self, frame_bgr: np.ndarray) -> Tuple[Optional[DetectionResult], np.ndarray]:
        """
        Immediate tip find vs empty-board background from last B.
        Order: B (empty) → stick dart → T.
        """
        gray = self._prep(frame_bgr)
        overlay = frame_bgr.copy()
        if self._bg is None:
            self.reset_background(frame_bgr)
            self._last_event = (
                "FORCE: no empty bg yet — board locked as empty NOW. "
                "Stick a dart, then press T again."
            )
            return None, self._annotate(overlay, gray, None, force=True)

        # Prefer true empty-board snapshot so T still works after an auto-hit
        ref = self._bg_empty if self._bg_empty is not None else self._bg
        tip, th, fg = self._measure_tip(gray, ref)
        # If empty-board ref is too noisy/empty, try working bg
        if tip is None and self._bg is not None and ref is not self._bg:
            tip2, th2, fg2 = self._measure_tip(gray, self._bg)
            if tip2 is not None or fg2 > fg:
                tip, th, fg = tip2, th2, fg2

        self._last_fg_pixels = fg
        self._last_mask = th
        result = None
        if tip is not None and fg >= max(8, self._scaled_min_fg // 3):
            tx, ty = tip
            conf = self._confidence(th, tip, float(fg))
            conf = max(conf, 0.55)
            hit = self.calib.hit_at_pixel(tx, ty, confidence=conf)
            result = DetectionResult(
                hit=hit,
                tip_xy=(tx, ty),
                motion_score=float(fg),
                camera_id=self.calib.camera_id,
            )
            self._last_event = (
                f"FORCE HIT {hit.kind} {hit.number} conf={hit.confidence:.2f} "
                f"tip=({tx:.0f},{ty:.0f}) fg={fg}"
            )
            # Working bg includes dart; empty snapshot stays for next force if user removes
            self._bg = gray.astype(np.float32)
            cv2.circle(overlay, (int(tx), int(ty)), 12, (0, 255, 255), 2)
            cv2.putText(
                overlay,
                f"FORCE {hit.kind} {hit.number}",
                (int(tx) + 12, int(ty)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 255),
                2,
            )
        else:
            self._last_event = (
                f"FORCE no tip fg={fg} — do: empty board + B, THEN stick dart, THEN T. "
                f"(If you already auto-detected, remove dart, B, re-stick, T)"
            )
        return result, self._annotate(overlay, gray, th, force=True)

    def _update_scales(self, shape: Tuple[int, int]) -> None:
        h, w = shape[:2]
        self._frame_shape = (h, w)
        # Reference: 640x480. HD gets slightly higher absolute thresholds.
        scale = max(0.5, (w * h) / (640.0 * 480.0))
        # sqrt so 1080p (~7x pixels) isn't 7x harder
        s = scale ** 0.5
        self._scaled_min_fg = max(15, int(self.config.min_motion_pixels * s))
        self._scaled_settle = max(40, int(self.config.settle_motion_pixels * s))
        self._scaled_spike = max(60, int(self.config.spike_motion_pixels * s))

    def _prep(self, frame_bgr: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        return gray

    def _roi_mask(self, shape: Tuple[int, int]) -> np.ndarray:
        h, w = shape
        mask = np.zeros((h, w), dtype=np.uint8)
        cx = int(self.calib.center_x)
        cy = int(self.calib.center_y)
        scale = self.config.roi_scale
        # Oblique: use ellipse ROI when available
        if self.calib.ellipse_a and self.calib.ellipse_b:
            sa = float(self.calib.ellipse_a) * scale
            sb = float(self.calib.ellipse_b) * scale
            ang = float(self.calib.ellipse_angle_deg or 0.0)
            if sa >= 15 and sb >= 15:
                cv2.ellipse(
                    mask,
                    ((cx, cy), (sa * 2, sb * 2), ang),
                    255,
                    -1,
                )
                return mask
        r = int(self.calib.radius_px * scale)
        if r < 20 or cx < 0 or cy < 0 or cx >= w or cy >= h:
            mask[:] = 255
            return mask
        cv2.circle(mask, (cx, cy), max(r, 10), 255, -1)
        return mask

    def _fg_mask(self, gray: np.ndarray, bg: np.ndarray, thr: Optional[int] = None) -> Tuple[np.ndarray, int]:
        cfg = self.config
        thr = cfg.motion_threshold if thr is None else thr
        bg_u8 = cv2.convertScaleAbs(bg) if bg.dtype != np.uint8 else bg
        roi = self._roi_mask(gray.shape)
        diff = cv2.absdiff(gray, bg_u8)
        diff = cv2.bitwise_and(diff, diff, mask=roi)
        _, th = cv2.threshold(diff, thr, 255, cv2.THRESH_BINARY)
        th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        return th, int(np.count_nonzero(th))

    def _measure_tip(
        self, gray: np.ndarray, bg: np.ndarray
    ) -> Tuple[Optional[Tuple[float, float]], np.ndarray, int]:
        thr = max(6, self.config.motion_threshold - 2)
        th, fg = self._fg_mask(gray, bg, thr=thr)
        tip = self._find_tip(th)
        return tip, th, fg

    def process(
        self, frame_bgr: np.ndarray
    ) -> Tuple[Optional[DetectionResult], np.ndarray]:
        gray = self._prep(frame_bgr)
        overlay = frame_bgr.copy()
        cfg = self.config
        self._last_event = ""

        if self._bg is None:
            self.reset_background(frame_bgr)
            return None, self._annotate(overlay, gray, None)

        if self._frame_shape != gray.shape:
            self._update_scales(gray.shape)

        th, fg_pixels = self._fg_mask(gray, self._bg)
        self._last_fg_pixels = fg_pixels
        self._last_mask = th
        self._last_motion = float(fg_pixels)
        something_new = fg_pixels >= self._scaled_min_fg

        # Frame-to-frame motion
        if self._prev_gray is not None and self._prev_gray.shape == gray.shape:
            roi = self._roi_mask(gray.shape)
            fdiff = cv2.absdiff(gray, self._prev_gray)
            fdiff = cv2.bitwise_and(fdiff, fdiff, mask=roi)
            _, fth = cv2.threshold(fdiff, max(6, cfg.motion_threshold - 2), 255, cv2.THRESH_BINARY)
            fth = cv2.morphologyEx(fth, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            frame_motion = int(np.count_nonzero(fth))
        else:
            frame_motion = 0
        self._prev_gray = gray.copy()
        self._last_frame_motion = frame_motion
        still_moving = frame_motion >= self._scaled_settle
        spike = frame_motion >= self._scaled_spike

        # Start cycle
        if not self._pending and (something_new or spike):
            self._bg_frozen = self._bg.copy()
            self._pending = True
            self._quiet_streak = 0
            self._motion_streak = 1
            why = "fg" if something_new else "spike"
            self._last_event = (
                f"motion_start({why}) fg={fg_pixels}/{self._scaled_min_fg} "
                f"f2f={frame_motion}/{self._scaled_settle}"
            )
        elif self._pending:
            self._motion_streak += 1
            if still_moving:
                self._quiet_streak = 0
            else:
                self._quiet_streak += 1
        else:
            # Idle: only learn if very quiet (avoid eating the dart into bg)
            if fg_pixels < self._scaled_min_fg // 2 and not still_moving:
                cv2.accumulateWeighted(gray, self._bg, cfg.bg_learn_rate_idle)

        result: Optional[DetectionResult] = None
        should_measure = self._pending and (
            self._quiet_streak >= cfg.settle_frames
            or self._motion_streak >= cfg.max_pending_frames
        )

        if should_measure:
            ref = self._bg_frozen if self._bg_frozen is not None else self._bg
            tip, th2, fg2 = self._measure_tip(gray, ref)
            self._last_mask = th2
            forced_timeout = self._motion_streak >= cfg.max_pending_frames

            if tip is not None:
                tx, ty = tip
                conf = self._confidence(th2, tip, float(max(fg_pixels, fg2)))
                hit = self.calib.hit_at_pixel(tx, ty, confidence=conf)
                result = DetectionResult(
                    hit=hit,
                    tip_xy=(tx, ty),
                    motion_score=float(fg_pixels),
                    camera_id=self.calib.camera_id,
                )
                tag = "timeout" if forced_timeout else "settle"
                self._last_event = (
                    f"HIT({tag}) {hit.kind} {hit.number} conf={hit.confidence:.2f} "
                    f"tip=({tx:.0f},{ty:.0f}) fg={fg2}"
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
                self._bg = gray.astype(np.float32)
            else:
                self._last_event = (
                    f"settle_no_tip fg={fg_pixels} f2f={frame_motion} "
                    f"pending_frames={self._motion_streak}"
                )
                # Soft adapt so we don't stick forever
                cv2.accumulateWeighted(gray, self._bg, 0.25)

            self._pending = False
            self._quiet_streak = 0
            self._bg_frozen = None
            self._motion_streak = 0

        return result, self._annotate(overlay, gray, self._last_mask)

    def _annotate(
        self,
        overlay: np.ndarray,
        gray: np.ndarray,
        th: Optional[np.ndarray],
        force: bool = False,
    ) -> np.ndarray:
        cx, cy = int(self.calib.center_x), int(self.calib.center_y)
        r = int(self.calib.radius_px)
        if self.calib.ellipse_a and self.calib.ellipse_b:
            sa = float(self.calib.ellipse_a)
            sb = float(self.calib.ellipse_b)
            eang = float(self.calib.ellipse_angle_deg or 0.0)
            cv2.ellipse(overlay, ((cx, cy), (sa * 2, sb * 2), eang), (80, 200, 255), 1)
        else:
            cv2.circle(overlay, (cx, cy), r, (80, 80, 80), 1)
        cv2.circle(overlay, (cx, cy), 4, (0, 255, 0), -1)

        if th is not None and th.shape[:2] == overlay.shape[:2]:
            color_m = cv2.cvtColor(th, cv2.COLOR_GRAY2BGR)
            color_m[:, :, 0] = 0
            color_m[:, :, 1] = 0
            overlay = cv2.addWeighted(overlay, 1.0, color_m, 0.45, 0)

        active = self._last_fg_pixels >= self._scaled_min_fg or self._pending
        color = (0, 255, 255) if force else ((0, 255, 0) if active else (220, 220, 220))
        model = getattr(self.calib, "model", "circle")
        lines = [
            f"{self.calib.camera_id}  fg={self._last_fg_pixels}/{self._scaled_min_fg}  "
            f"f2f={self._last_frame_motion}/{self._scaled_settle}",
            f"pending={int(self._pending)} quiet={self._quiet_streak}  "
            f"model={model} @({cx},{cy})",
            "B=empty board  T=force detect dart  Q=quit",
        ]
        y = 26
        for line in lines:
            cv2.putText(overlay, line, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
            y += 22
        return overlay

    def _find_tip(self, mask: np.ndarray) -> Optional[Tuple[float, float]]:
        """
        Tip ≈ point on the new blob closest to the bull (dart points inward).
        Prefer elongated thin contours (shaft); reject huge hand-sized blobs.
        """
        cfg = self.config
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        cx, cy = self.calib.center_x, self.calib.center_y
        best_tip = None
        best_score = -1.0

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < cfg.min_blob_area or area > cfg.max_blob_area:
                continue
            # Reject nearly circular fat blobs (noise/lighting) — prefer elongated
            peri = cv2.arcLength(cnt, True)
            circularity = 4.0 * math.pi * area / max(peri * peri, 1e-3)
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
            r_norm = float(d[i] / max(self.calib.radius_px, 1))
            if r_norm > 1.15:
                continue
            # Prefer elongated shaft-like blobs nearer the board
            score = (
                (1.2 - min(r_norm, 1.15))
                * (1.0 + min(elong, 6.0))
                * np.log1p(area)
                * (1.2 - min(circularity, 1.0))
            )
            if score > best_score:
                best_score = score
                best_tip = tip

        # No centroid fallback — that scored flights/barrels and was wildly wrong
        return best_tip

    def _confidence(
        self, mask: np.ndarray, tip: Tuple[float, float], fg_pixels: float
    ) -> float:
        """More conservative confidence — geometry matters more than blob size."""
        area = float(np.count_nonzero(mask))
        # Huge area → likely hand/noise, lower confidence
        if area > self.config.max_blob_area * 0.85:
            return 0.25
        r, _ = self.calib.to_polar(tip[0], tip[1])
        if r > 1.08:
            return 0.3
        # Dart-sized blob
        size_ok = 1.0 - abs(np.clip(area, 30, 4000) - 400) / 4000.0
        size_ok = float(np.clip(size_ok, 0.2, 1.0))
        in_board = 1.0 if r <= 1.0 else 0.4
        conf = 0.35 + 0.35 * size_ok + 0.25 * in_board
        if 0.05 < r < 0.98:
            conf += 0.05
        return float(np.clip(conf, 0.0, 0.95))
