"""
Board calibration per camera.

Supports:
  1. Circle model (nadir / face-on) — legacy
  2. Ellipse model — outer double is an ellipse under oblique view
  3. Homography — 4 points on outer double at known board angles (best)

Oblique cameras (side mounts, not looking straight at the board) MUST use
ellipse or homography; a plain circle will mis-score segments badly.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any, List, Optional, Tuple

import cv2
import numpy as np

from .board_geometry import (
    homography_board_to_image,
    pixel_to_polar,
    pixel_to_polar_ellipse,
    pixel_to_polar_homography,
    polar_to_segment,
)


@dataclass
class BoardCalibration:
    camera_id: str
    center_x: float
    center_y: float
    radius_px: float
    # Degrees: image direction of segment 20 relative to image-up, clockwise
    rotation_deg: float = 0.0
    # Ellipse of outer double (semi-axes in pixels, OpenCV angle)
    ellipse_a: Optional[float] = None
    ellipse_b: Optional[float] = None
    ellipse_angle_deg: Optional[float] = None
    # Optional full perspective: board→image 3x3 (unit circle, 0° at +Y / 20)
    H_board_to_image: Optional[List[List[float]]] = None
    # Legacy aliases
    axis_x: Optional[float] = None
    axis_y: Optional[float] = None
    image_width: int = 0
    image_height: int = 0
    model: str = "circle"  # circle | ellipse | homography

    def __post_init__(self) -> None:
        # Promote legacy axis_x/y
        if self.ellipse_a is None and self.axis_x is not None:
            self.ellipse_a = float(self.axis_x)
        if self.ellipse_b is None and self.axis_y is not None:
            self.ellipse_b = float(self.axis_y)
        if self.H_board_to_image is not None:
            self.model = "homography"
        elif self.ellipse_a and self.ellipse_b:
            self.model = "ellipse"
        else:
            self.model = "circle"

    @property
    def uses_perspective(self) -> bool:
        return self.model in ("ellipse", "homography")

    def to_polar(self, x: float, y: float) -> Tuple[float, float]:
        if self.model == "homography" and self.H_board_to_image is not None:
            H = np.asarray(self.H_board_to_image, dtype=np.float64)
            try:
                H_inv = np.linalg.inv(H)
            except np.linalg.LinAlgError:
                H_inv = None
            if H_inv is not None:
                return pixel_to_polar_homography(
                    x, y, H_inv, rotation_deg=0.0
                )
        if (
            self.model == "ellipse"
            or (self.ellipse_a and self.ellipse_b)
        ) and self.ellipse_a and self.ellipse_b:
            ang = self.ellipse_angle_deg if self.ellipse_angle_deg is not None else 0.0
            return pixel_to_polar_ellipse(
                x,
                y,
                self.center_x,
                self.center_y,
                float(self.ellipse_a),
                float(self.ellipse_b),
                float(ang),
                self.rotation_deg,
            )
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
        # Drop unknown keys for forward compat
        known = {f.name for f in fields(BoardCalibration)}
        data = {k: v for k, v in data.items() if k in known}
        return BoardCalibration(**data)


def _open_source(source: int | str) -> cv2.VideoCapture:
    if isinstance(source, str) and source.isdigit():
        source = int(source)
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


def fit_board_ellipse(
    frame_bgr: np.ndarray,
    center_hint: Optional[Tuple[float, float]] = None,
    radius_hint: Optional[float] = None,
) -> Optional[Tuple[float, float, float, float, float]]:
    """
    Fit outer-board ellipse for oblique views.
    Returns (cx, cy, semi_a, semi_b, angle_deg) or None.
    """
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    blur = cv2.GaussianBlur(gray, (7, 7), 0)
    edges = cv2.Canny(blur, 40, 120)
    # Prefer edges near expected board ring
    if center_hint and radius_hint and radius_hint > 20:
        mask = np.zeros_like(edges)
        cx, cy = int(center_hint[0]), int(center_hint[1])
        r = int(radius_hint)
        cv2.circle(mask, (cx, cy), int(r * 1.25), 255, -1)
        cv2.circle(mask, (cx, cy), max(int(r * 0.45), 10), 0, -1)
        edges = cv2.bitwise_and(edges, mask)

    pts = cv2.findNonZero(edges)
    if pts is None or len(pts) < 60:
        # Fallback: Hough circle → treat as circle ellipse
        circles = cv2.HoughCircles(
            blur,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=min(h, w) // 4,
            param1=100,
            param2=35,
            minRadius=min(h, w) // 10,
            maxRadius=min(h, w) // 2,
        )
        if circles is None:
            return None
        c = max(np.round(circles[0, :]).astype(int), key=lambda t: t[2])
        return float(c[0]), float(c[1]), float(c[2]), float(c[2]), 0.0

    # Contours → largest elliptical-ish ring
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    best = None
    best_score = -1.0
    for cnt in contours:
        if len(cnt) < 40:
            continue
        area = cv2.contourArea(cnt)
        if area < (min(h, w) ** 2) * 0.02:
            continue
        try:
            ell = cv2.fitEllipse(cnt)
        except cv2.error:
            continue
        (ecx, ecy), (ma, mi), ang = ell
        # OpenCV returns full axis lengths
        sa, sb = ma / 2.0, mi / 2.0
        if sa < 20 or sb < 20:
            continue
        ratio = max(sa, sb) / max(min(sa, sb), 1e-3)
        if ratio > 3.5:  # too skinny
            continue
        # Prefer larger, more circular-ish, near center of frame
        center_dist = math.hypot(ecx - w / 2, ecy - h / 2) / max(w, h)
        score = math.sqrt(sa * sb) * (1.0 - 0.3 * center_dist) / max(ratio, 1.0)
        if center_hint and radius_hint:
            d = math.hypot(ecx - center_hint[0], ecy - center_hint[1])
            if d > radius_hint * 0.5:
                score *= 0.3
            score *= 1.0 / (1.0 + abs(max(sa, sb) - radius_hint) / max(radius_hint, 1))
        if score > best_score:
            best_score = score
            best = (float(ecx), float(ecy), float(sa), float(sb), float(ang))
    return best


def ellipse_to_homography(
    cx: float,
    cy: float,
    sa: float,
    sb: float,
    ell_angle_deg: float,
    rotation_deg: float = 0.0,
) -> Optional[List[List[float]]]:
    """
    Build board→image homography from ellipse + 20-direction.
    Samples 4 points on the ellipse at board angles 0/90/180/270.
    """
    image_pts = []
    board_angles = (0.0, 90.0, 180.0, 270.0)
    th = math.radians(ell_angle_deg)
    c, s = math.cos(th), math.sin(th)
    for bang in board_angles:
        # Board angle → unit disk (before image ellipse)
        # board 0° = toward 20 = after rotation_deg in ellipse-normalized space
        a_img = math.radians((bang + rotation_deg) % 360.0)
        # unit disk u,v with 0 at top (-v), clockwise: u=sin, v=-cos
        u = math.sin(a_img)
        v = -math.cos(a_img)
        # ellipse-aligned → image
        xr = u * sa
        yr = v * sb
        # rotate by ellipse angle to image
        ix = cx + c * xr - s * yr
        iy = cy + s * xr + c * yr
        image_pts.append((ix, iy))
    return homography_board_to_image(image_pts, board_angles)


def build_calibration(
    camera_id: str,
    frame_bgr: np.ndarray,
    center_x: float,
    center_y: float,
    radius_px: float,
    rotation_deg: float = 0.0,
    *,
    force_ellipse: bool = True,
) -> BoardCalibration:
    """
    Build calib with ellipse/homography for oblique views when possible.
    """
    h, w = frame_bgr.shape[:2]
    ell = fit_board_ellipse(
        frame_bgr, center_hint=(center_x, center_y), radius_hint=radius_px
    )
    ellipse_a = ellipse_b = ellipse_angle = None
    H = None
    model = "circle"
    if ell and force_ellipse:
        ecx, ecy, sa, sb, eang = ell
        # Prefer vision center if close; else ellipse center (better for oblique)
        if math.hypot(ecx - center_x, ecy - center_y) < radius_px * 0.25:
            center_x, center_y = ecx, ecy
        else:
            # blend
            center_x = 0.4 * center_x + 0.6 * ecx
            center_y = 0.4 * center_y + 0.6 * ecy
        ellipse_a, ellipse_b, ellipse_angle = sa, sb, eang
        radius_px = math.sqrt(sa * sb)  # geometric mean as effective R
        H = ellipse_to_homography(
            center_x, center_y, sa, sb, eang, rotation_deg=rotation_deg
        )
        model = "homography" if H is not None else "ellipse"
        # Aspect ratio: how oblique
        aspect = max(sa, sb) / max(min(sa, sb), 1e-3)
        if aspect < 1.05 and H is None:
            model = "circle"

    return BoardCalibration(
        camera_id=camera_id,
        center_x=float(center_x),
        center_y=float(center_y),
        radius_px=float(radius_px),
        rotation_deg=float(rotation_deg),
        ellipse_a=float(ellipse_a) if ellipse_a else None,
        ellipse_b=float(ellipse_b) if ellipse_b else None,
        ellipse_angle_deg=float(ellipse_angle) if ellipse_angle is not None else None,
        axis_x=float(ellipse_a) if ellipse_a else None,
        axis_y=float(ellipse_b) if ellipse_b else None,
        H_board_to_image=H,
        image_width=w,
        image_height=h,
        model=model,
    )


def interactive_calibrate(
    source: int | str,
    camera_id: str = "cam0",
    out_path: str | Path = "./calib/cam0.json",
) -> BoardCalibration:
    """
    Keyboard:
      c – set center to current mouse position
      r – set outer radius (or ellipse via auto-fit after c+r)
      t – set rotation so mouse angle is center of 20
      e – force OpenCV ellipse fit around current center/radius
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
        "ell": None,
    }

    def on_mouse(event, x, y, flags, param):  # noqa: ARG001
        state["mx"], state["my"] = x, y

    win = f"No3 Calibrate – {camera_id} (oblique OK)"
    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)

    print(
        "Calibration (oblique cameras supported):\n"
        "  [c]enter  [r]adius  [t]wenty-dir  [e]llipse-fit  [s]ave  [q]uit\n"
        "  Tip: set center + outer double, press E to fit ellipse for angled cams."
    )

    calib: Optional[BoardCalibration] = None
    last_frame = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        last_frame = frame
        vis = frame.copy()
        h, w = vis.shape[:2]
        mx, my = state["mx"], state["my"]
        cv2.drawMarker(vis, (mx, my), (0, 255, 255), cv2.MARKER_CROSS, 16, 1)

        if state["cx"] is not None:
            cx, cy = int(state["cx"]), int(state["cy"])
            cv2.circle(vis, (cx, cy), 4, (0, 255, 0), -1)
            if state["ell"] is not None:
                ecx, ecy, sa, sb, eang = state["ell"]
                # OpenCV ellipse uses full axes
                cv2.ellipse(
                    vis,
                    ((ecx, ecy), (sa * 2, sb * 2), eang),
                    (0, 200, 255),
                    2,
                )
            elif state["radius"]:
                cv2.circle(vis, (cx, cy), int(state["radius"]), (0, 200, 255), 2)
            if state["radius"] or state["ell"]:
                rdraw = state["radius"] or (
                    math.sqrt(state["ell"][2] * state["ell"][3]) if state["ell"] else 50
                )
                theta = math.radians(state["rot"])
                ex = int(cx + rdraw * math.sin(theta))
                ey = int(cy - rdraw * math.cos(theta))
                cv2.line(vis, (cx, cy), (ex, ey), (0, 255, 0), 2)
                cv2.putText(
                    vis, "20", (ex + 6, ey), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2
                )

        mode = "ellipse" if state["ell"] else "circle"
        help_lines = [
            f"mouse=({mx},{my})  center={state['cx']},{state['cy']}  "
            f"R={state['radius']}  rot={state['rot']:.1f}  model={mode}",
            "[c]enter [r]adius [t]wenty [e]llipse-fit [s]ave [q]uit",
        ]
        y0 = 24
        for line in help_lines:
            cv2.putText(vis, line, (10, y0), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (240, 240, 240), 1)
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
                state["radius"] = float(np.hypot(mx - state["cx"], my - state["cy"]))
                print(f"Radius set to {state['radius']:.1f}px")
        elif key == ord("t"):
            if state["cx"] is None:
                print("Set center first [c]")
            else:
                dx = mx - state["cx"]
                dy = my - state["cy"]
                ang = math.degrees(math.atan2(dx, -dy)) % 360.0
                state["rot"] = ang
                print(f"Rotation set so this point is 20: {state['rot']:.1f}°")
        elif key == ord("e"):
            if state["cx"] is None:
                print("Set center first [c]")
            else:
                ell = fit_board_ellipse(
                    frame,
                    center_hint=(state["cx"], state["cy"]),
                    radius_hint=state["radius"],
                )
                if ell is None:
                    print("Ellipse fit failed — improve lighting / framing")
                else:
                    state["ell"] = ell
                    state["cx"], state["cy"] = ell[0], ell[1]
                    state["radius"] = math.sqrt(ell[2] * ell[3])
                    print(
                        f"Ellipse: center=({ell[0]:.0f},{ell[1]:.0f}) "
                        f"semi=({ell[2]:.0f},{ell[3]:.0f}) ang={ell[4]:.1f}°"
                    )
        elif key == ord("s"):
            if state["cx"] is None or not state["radius"]:
                print("Need center [c] and radius [r] before save")
            else:
                if last_frame is not None:
                    calib = build_calibration(
                        camera_id,
                        last_frame,
                        float(state["cx"]),
                        float(state["cy"]),
                        float(state["radius"]),
                        float(state["rot"]),
                        force_ellipse=True,
                    )
                    if state["ell"] is not None:
                        ecx, ecy, sa, sb, eang = state["ell"]
                        calib.center_x, calib.center_y = ecx, ecy
                        calib.ellipse_a, calib.ellipse_b = sa, sb
                        calib.ellipse_angle_deg = eang
                        calib.axis_x, calib.axis_y = sa, sb
                        calib.radius_px = math.sqrt(sa * sb)
                        calib.H_board_to_image = ellipse_to_homography(
                            ecx, ecy, sa, sb, eang, state["rot"]
                        )
                        calib.model = (
                            "homography" if calib.H_board_to_image else "ellipse"
                        )
                        calib.rotation_deg = float(state["rot"])
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
                print(f"Saved calibration → {out_path}  model={calib.model}")
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
    cx, cy, r = max(circles, key=lambda c: c[2])
    return float(cx), float(cy), float(r)
