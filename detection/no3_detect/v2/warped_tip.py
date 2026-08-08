"""
Tip detection in a *warped top-down board view*.

Why this is better than raw-image polar tips:
  - After homography, the board is a circle and the tip is the
    foreground point nearest the bull (DeepDarts / many DIY scorers).
  - Shaft direction is easier to fit; multi-cam fuse in board (x,y).

Pipeline:
  image → warp to board canvas (pixels = board plane)
  bg-diff → blob → tip (nearest bull or shaft endpoint toward bull)
  canvas pixel → board (x,y) in [-1.2,1.2]
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np

from .board_plane import BoardPoint
from .cam_calib import CamCalib


# Canvas: board plane mapped so outer double is a circle of radius R_PX
CANVAS = 512
R_PX = 200  # outer double radius in canvas pixels
CX = CANVAS // 2
CY = CANVAS // 2


def board_to_canvas(x: float, y: float) -> Tuple[float, float]:
    """Board (x,y) with r=1 at outer double → canvas pixel."""
    return CX + x * R_PX, CY - y * R_PX  # +Y board up → -row


def canvas_to_board(u: float, v: float) -> Tuple[float, float]:
    return (u - CX) / R_PX, (CY - v) / R_PX


@dataclass
class WarpTipConfig:
    motion_threshold: int = 14
    min_blob_area: int = 15
    max_blob_area: int = 8000
    min_fg_pixels: int = 25
    settle_f2f_pixels: int = 80
    settle_frames: int = 5
    max_pending: int = 40
    # Only search inside this board radius (slightly past double)
    roi_r: float = 1.12


@dataclass
class WarpTipResult:
    board: BoardPoint
    canvas_uv: Tuple[float, float]
    tip_uv_image: Tuple[float, float]
    fg_pixels: int


class WarpedTipDetector:
    """
    Per-camera detector operating in top-down board canvas space.
    """

    def __init__(self, calib: CamCalib, config: Optional[WarpTipConfig] = None):
        self.calib = calib
        self.cfg = config or WarpTipConfig()
        self._H_img_to_canvas: Optional[np.ndarray] = None
        self._H_canvas_to_img: Optional[np.ndarray] = None
        self._build_warp()
        self._bg: Optional[np.ndarray] = None  # float32 canvas gray
        self._bg_frozen: Optional[np.ndarray] = None
        self._prev: Optional[np.ndarray] = None
        self._pending = False
        self._quiet = 0
        self._streak = 0
        self.last_fg = 0
        self.last_f2f = 0
        self.last_event = ""
        self._roi = self._make_roi()

    def _build_warp(self) -> None:
        """
        Map image → canvas so ideal board points land on the circle.
        image_points (20,6,3,11) → canvas points at board angles.
        """
        src = np.float32(self.calib.image_points[:4])
        dst = []
        for ang in (0.0, 90.0, 180.0, 270.0):
            a = np.deg2rad(ang)
            bx, by = np.sin(a), np.cos(a)
            u, v = board_to_canvas(float(bx), float(by))
            dst.append([u, v])
        dst_a = np.float32(dst)
        H = cv2.getPerspectiveTransform(src, dst_a)
        self._H_img_to_canvas = H
        self._H_canvas_to_img = cv2.invert(H)[1]

    def _make_roi(self) -> np.ndarray:
        mask = np.zeros((CANVAS, CANVAS), dtype=np.uint8)
        cv2.circle(mask, (CX, CY), int(R_PX * self.cfg.roi_r), 255, -1)
        return mask

    def _warp_gray(self, frame_bgr: np.ndarray) -> np.ndarray:
        g = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        g = cv2.GaussianBlur(g, (5, 5), 0)
        assert self._H_img_to_canvas is not None
        return cv2.warpPerspective(g, self._H_img_to_canvas, (CANVAS, CANVAS))

    def reset_background(self, frame_bgr: np.ndarray) -> None:
        w = self._warp_gray(frame_bgr)
        self._bg = w.astype(np.float32)
        self._bg_frozen = None
        self._prev = w.copy()
        self._pending = False
        self._quiet = 0
        self._streak = 0
        self.last_event = "bg_reset"

    def process(
        self, frame_bgr: np.ndarray
    ) -> Tuple[Optional[WarpTipResult], np.ndarray]:
        self.last_event = ""
        cfg = self.cfg
        warped = self._warp_gray(frame_bgr)
        overlay = frame_bgr.copy()

        if self._bg is None:
            self.reset_background(frame_bgr)
            return None, self._annotate(overlay, None, warped, None)

        bg = cv2.convertScaleAbs(self._bg)
        diff = cv2.absdiff(warped, bg)
        diff = cv2.bitwise_and(diff, diff, mask=self._roi)
        _, th = cv2.threshold(diff, cfg.motion_threshold, 255, cv2.THRESH_BINARY)
        th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        fg = int(np.count_nonzero(th))
        self.last_fg = fg

        if self._prev is not None:
            fdiff = cv2.absdiff(warped, self._prev)
            fdiff = cv2.bitwise_and(fdiff, fdiff, mask=self._roi)
            _, fth = cv2.threshold(fdiff, max(6, cfg.motion_threshold - 2), 255, cv2.THRESH_BINARY)
            f2f = int(np.count_nonzero(fth))
        else:
            f2f = 0
        self._prev = warped.copy()
        self.last_f2f = f2f

        new_obj = fg >= cfg.min_fg_pixels
        moving = f2f >= cfg.settle_f2f_pixels

        if new_obj and not self._pending:
            self._bg_frozen = self._bg.copy()
            self._pending = True
            self._quiet = 0
            self._streak = 1
            self.last_event = f"motion fg={fg}"
        elif self._pending:
            self._streak += 1
            self._quiet = 0 if moving else self._quiet + 1
        else:
            if fg < cfg.min_fg_pixels // 2:
                cv2.accumulateWeighted(warped, self._bg, 0.004)

        result: Optional[WarpTipResult] = None
        tip_c: Optional[Tuple[float, float]] = None
        if self._pending and (
            self._quiet >= cfg.settle_frames or self._streak >= cfg.max_pending
        ):
            ref = self._bg_frozen if self._bg_frozen is not None else self._bg
            ref_u8 = cv2.convertScaleAbs(ref)
            diff2 = cv2.absdiff(warped, ref_u8)
            diff2 = cv2.bitwise_and(diff2, diff2, mask=self._roi)
            _, th2 = cv2.threshold(
                diff2, max(8, cfg.motion_threshold - 3), 255, cv2.THRESH_BINARY
            )
            th2 = cv2.morphologyEx(th2, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
            th2 = cv2.morphologyEx(th2, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            tip_c = self._find_tip_canvas(th2)
            th = th2

            if tip_c is not None:
                bx, by = canvas_to_board(tip_c[0], tip_c[1])
                r = float(np.hypot(bx, by))
                conf = 0.5
                if r <= 1.08:
                    conf = 0.72
                if r <= 1.0:
                    conf += 0.08
                conf = min(0.96, conf + min(fg, 300) / 1500.0)
                # image tip for drawing
                assert self._H_canvas_to_img is not None
                p = self._H_canvas_to_img @ np.array(
                    [tip_c[0], tip_c[1], 1.0], dtype=np.float64
                )
                iu, iv = float(p[0] / p[2]), float(p[1] / p[2])
                result = WarpTipResult(
                    board=BoardPoint(
                        x=bx, y=by, confidence=conf, camera_id=self.calib.camera_id
                    ),
                    canvas_uv=tip_c,
                    tip_uv_image=(iu, iv),
                    fg_pixels=fg,
                )
                self.last_event = f"tip board=({bx:.3f},{by:.3f}) r={r:.3f} conf={conf:.2f}"
                self._bg = warped.astype(np.float32)
            else:
                self.last_event = "settle_no_tip"
                cv2.accumulateWeighted(warped, self._bg, 0.2)
            self._pending = False
            self._quiet = 0
            self._streak = 0
            self._bg_frozen = None

        return result, self._annotate(overlay, result, warped, th)

    def _find_tip_canvas(self, mask: np.ndarray) -> Optional[Tuple[float, float]]:
        """
        Tip = point on blob closest to bull in canvas,
        preferring elongated shaft-like contours.
        Also try fitLine and take endpoint nearer bull.
        """
        cfg = self.cfg
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        best: Optional[Tuple[float, float]] = None
        best_score = -1.0

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < cfg.min_blob_area or area > cfg.max_blob_area:
                continue
            pts = cnt.reshape(-1, 2).astype(np.float32)
            d = np.hypot(pts[:, 0] - CX, pts[:, 1] - CY)
            i = int(np.argmin(d))
            tip = (float(pts[i, 0]), float(pts[i, 1]))

            # Shaft line: endpoints; prefer endpoint closer to bull
            if len(pts) >= 5:
                try:
                    vx, vy, x0, y0 = cv2.fitLine(cnt, cv2.DIST_L2, 0, 0.01, 0.01)
                    vx, vy = float(vx), float(vy)
                    # project all points onto line, take extremes
                    t = (pts[:, 0] - float(x0)) * vx + (pts[:, 1] - float(y0)) * vy
                    p1 = pts[int(np.argmin(t))]
                    p2 = pts[int(np.argmax(t))]
                    d1 = float(np.hypot(p1[0] - CX, p1[1] - CY))
                    d2 = float(np.hypot(p2[0] - CX, p2[1] - CY))
                    tip = (float(p1[0]), float(p1[1])) if d1 <= d2 else (float(p2[0]), float(p2[1]))
                    elong = float(np.hypot(p2[0] - p1[0], p2[1] - p1[1])) / max(
                        np.sqrt(area / max(np.pi, 1)), 1.0
                    )
                except cv2.error:
                    elong = 1.0
            else:
                elong = 1.0

            r_board = float(np.hypot(tip[0] - CX, tip[1] - CY)) / R_PX
            if r_board > cfg.roi_r:
                continue
            score = (1.2 - min(r_board, 1.15)) * min(elong, 8.0) * np.log1p(area)
            if score > best_score:
                best_score = score
                best = tip

        return best

    def _annotate(
        self,
        overlay: np.ndarray,
        result: Optional[WarpTipResult],
        warped: np.ndarray,
        th: Optional[np.ndarray],
    ) -> np.ndarray:
        overlay = self.calib.draw_overlay(overlay)
        if result is not None:
            u, v = result.tip_uv_image
            cv2.circle(overlay, (int(u), int(v)), 11, (0, 255, 255), 2)
            cv2.putText(
                overlay,
                f"({result.board.x:.2f},{result.board.y:.2f})",
                (int(u) + 12, int(v)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 255),
                1,
            )
        # small warped preview corner
        try:
            preview = warped.copy()
            if th is not None:
                preview = cv2.addWeighted(
                    preview, 0.7, th, 0.3, 0
                )
            cv2.circle(preview, (CX, CY), R_PX, (200, 200, 200), 1)
            if result is not None:
                cu, cv_ = result.canvas_uv
                cv2.circle(preview, (int(cu), int(cv_)), 6, (0, 255, 255), 2)
            small = cv2.resize(preview, (160, 160))
            small_bgr = cv2.cvtColor(small, cv2.COLOR_GRAY2BGR)
            h, w = overlay.shape[:2]
            overlay[8 : 8 + 160, w - 168 : w - 8] = small_bgr
        except Exception:
            pass
        cv2.putText(
            overlay,
            f"{self.calib.camera_id} WARPED fg={self.last_fg} f2f={self.last_f2f} "
            f"pend={int(self._pending)}",
            (10, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 255, 0),
            1,
        )
        return overlay
