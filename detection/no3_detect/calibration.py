"""
Board calibration per camera.

Calibration stores the board ellipse (or circle) in image coordinates and
the rotation so segment 20 is at the top.

Interactive mode: click center, then a point on the outer double wire
at the middle of the 20 segment (or top of board if already aligned).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional, Tuple

import cv2
import numpy as np

from .board_geometry import pixel_to_polar, polar_to_segment


@dataclass
class BoardCalibration:
    camera_id: str
    center_x: float
    center_y: float
    radius_px: float
    # Degrees clockwise: image-up → real board "20" direction
    rotation_deg: float = 0.0
    # Optional ellipse axes if board is foreshortened
    axis_x: Optional[float] = None
    axis_y: Optional[float] = None
    image_width: int = 0
    image_height: int = 0

    def to_polar(self, x: float, y: float) -> Tuple[float, float]:
        # Simple circular model; ellipse can be added later via warp
        return pixel_to_polar(
            x, y, self.center_x, self.center_y, self.radius_px, self.rotation_deg
        )

    def hit_at_pixel(self, x: float, y: float, confidence: float = 1.0):
        r, a = self.to_polar(x, y)
        return polar_to_segment(r, a, confidence=confidence)

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2))

    @staticmethod
    def load(path: str | Path) -> "BoardCalibration":
        data: dict[str, Any] = json.loads(Path(path).read_text())
        return BoardCalibration(**data)


def _open_source(source: int | str) -> cv2.VideoCapture:
    if isinstance(source, str) and source.isdigit():
        source = int(source)
    # CAP_DSHOW avoids long hangs / flaky indices on many Windows USB webcams
    if isinstance(source, int):
        cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(source)
    else:
        cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open camera source: {source}")
    return cap


def interactive_calibrate(
    source: int | str,
    camera_id: str = "cam0",
    out_path: str | Path = "./calib/cam0.json",
) -> BoardCalibration:
    """
    Keyboard:
      c – set center to current mouse position
      r – set outer radius (distance from center to mouse = double wire)
      t – set rotation so mouse angle is center of 20
      s – save and quit
      q – quit without save
    """
    cap = _open_source(source)
    state = {
        "cx": None,
        "cy": None,
        "radius": None,
        "rot": 0.0,
        "mx": 0,
        "my": 0,
    }

    def on_mouse(event, x, y, flags, param):  # noqa: ARG001
        state["mx"], state["my"] = x, y

    win = f"No3 Calibrate – {camera_id}"
    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)

    print(
        "Calibration controls:\n"
        "  Move mouse over board\n"
        "  [c] center  [r] outer double radius  [t] mark center of 20  [s] save  [q] quit"
    )

    calib: Optional[BoardCalibration] = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        vis = frame.copy()
        h, w = vis.shape[:2]
        mx, my = state["mx"], state["my"]
        cv2.drawMarker(vis, (mx, my), (0, 255, 255), cv2.MARKER_CROSS, 16, 1)

        if state["cx"] is not None:
            cx, cy = int(state["cx"]), int(state["cy"])
            cv2.circle(vis, (cx, cy), 4, (0, 255, 0), -1)
            if state["radius"]:
                cv2.circle(vis, (cx, cy), int(state["radius"]), (0, 200, 255), 2)
                # draw 20 direction
                import math

                ang = math.radians(state["rot"] - 90)  # image coords
                # 0 rot = top
                a = math.radians(-90 + state["rot"])
                # top direction in image for board angle 0 after rotation
                # vector for angle 0 (top of board in board space)
                # reverse of pixel_to_polar
                # for display: point at top of double wire in board space
                from math import cos, sin, radians

                # board angle 0 → image angle = rotation - 90? see pixel_to_polar inverse
                # image: ang_from_top_cw = board + rot
                # for board 0: image direction from center
                theta = radians(state["rot"])  # from top cw
                # top is -Y; cw means toward +X
                ex = int(cx + state["radius"] * sin(theta))
                ey = int(cy - state["radius"] * cos(theta))
                cv2.line(vis, (cx, cy), (ex, ey), (0, 255, 0), 2)
                cv2.putText(
                    vis, "20", (ex + 6, ey), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2
                )

        help_lines = [
            f"mouse=({mx},{my})  center={state['cx']},{state['cy']}  R={state['radius']}  rot={state['rot']:.1f}",
            "[c]enter [r]adius [t]wenty-dir [s]ave [q]uit",
        ]
        y0 = 24
        for line in help_lines:
            cv2.putText(vis, line, (10, y0), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (240, 240, 240), 1)
            y0 += 22

        cv2.imshow(win, vis)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("c"):
            state["cx"], state["cy"] = float(mx), float(my)
            print(f"Center set to {state['cx']}, {state['cy']}")
        elif key == ord("r"):
            if state["cx"] is None:
                print("Set center first [c]")
            else:
                state["radius"] = float(
                    np.hypot(mx - state["cx"], my - state["cy"])
                )
                print(f"Radius set to {state['radius']:.1f}px")
        elif key == ord("t"):
            if state["cx"] is None:
                print("Set center first [c]")
            else:
                # mouse is center of segment 20 → that angle should map to 0
                dx = mx - state["cx"]
                dy = my - state["cy"]
                import math

                ang = math.degrees(math.atan2(dx, -dy)) % 360.0
                # we want (ang - rotation) % 360 == 0 → rotation = ang
                state["rot"] = ang
                print(f"Rotation set so this point is 20: {state['rot']:.1f}°")
        elif key == ord("s"):
            if state["cx"] is None or not state["radius"]:
                print("Need center [c] and radius [r] before save")
            else:
                calib = BoardCalibration(
                    camera_id=camera_id,
                    center_x=float(state["cx"]),
                    center_y=float(state["cy"]),
                    radius_px=float(state["radius"]),
                    rotation_deg=float(state["rot"]),
                    image_width=w,
                    image_height=h,
                )
                calib.save(out_path)
                print(f"Saved calibration → {out_path}")
                break
        elif key == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    if calib is None:
        raise SystemExit("Calibration cancelled")
    return calib


def auto_detect_board_circle(frame_bgr: np.ndarray) -> Optional[Tuple[float, float, float]]:
    """
    Heuristic Hough circle on dark board – works only with good contrast.
    Returns (cx, cy, radius) or None.
    """
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.medianBlur(gray, 5)
    h, w = gray.shape
    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=min(h, w) // 4,
        param1=120,
        param2=40,
        minRadius=min(h, w) // 8,
        maxRadius=min(h, w) // 2,
    )
    if circles is None:
        return None
    circles = np.round(circles[0, :]).astype(int)
    # largest circle often the outer board
    cx, cy, r = max(circles, key=lambda c: c[2])
    return float(cx), float(cy), float(r)
