"""
Board calibration per camera.

For oblique (side-mounted) cameras the board is an ellipse in the image.
Auto edge-fit is often wrong — preferred path is interactive click-fit:

  python -m no3_detect calibrate --camera 0 --id cam0 --out ./calib/cam0.json

  1) Click ~8–12 points around the OUTER DOUBLE wire
  2) Press F to fit ellipse
  3) Move mouse to center of segment 20, press T
  4) Press S to save
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
    rotation_deg: float = 0.0
    ellipse_a: Optional[float] = None
    ellipse_b: Optional[float] = None
    ellipse_angle_deg: Optional[float] = None
    H_board_to_image: Optional[List[List[float]]] = None
    axis_x: Optional[float] = None
    axis_y: Optional[float] = None
    image_width: int = 0
    image_height: int = 0
    model: str = "circle"

    def __post_init__(self) -> None:
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
                return pixel_to_polar_homography(x, y, H_inv, rotation_deg=0.0)
        if self.ellipse_a and self.ellipse_b:
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


def fit_ellipse_from_points(
    pts: List[Tuple[float, float]],
    fixed_center: Optional[Tuple[float, float]] = None,
) -> Optional[Tuple[float, float, float, float, float]]:
    """
    Fit ellipse to outer-double click points.
    If fixed_center is set (true bullseye), center is locked there and axes
    are estimated around it — fixes "ellipse center nowhere near the bull".
    Returns (cx, cy, sa, sb, angle_deg).
    """
    if len(pts) < 5:
        return None
    arr = np.array(pts, dtype=np.float32).reshape(-1, 1, 2)
    try:
        (ecx, ecy), (ma, mi), ang = cv2.fitEllipse(arr)
    except cv2.error:
        return None
    sa, sb = ma / 2.0, mi / 2.0
    if sa < 10 or sb < 10:
        return None

    if fixed_center is None:
        return float(ecx), float(ecy), float(sa), float(sb), float(ang)

    # Lock center to real bull; re-estimate semi-axes from outer points
    cx, cy = float(fixed_center[0]), float(fixed_center[1])
    th = math.radians(float(ang))
    c, s = math.cos(th), math.sin(th)
    # In ellipse-aligned frame, points should lie near (xr/a)^2+(yr/b)^2 = 1
    # Estimate a,b by max extent first, then scale so mean radius on ellipse ≈ 1
    xrs: List[float] = []
    yrs: List[float] = []
    for px, py in pts:
        dx, dy = px - cx, py - cy
        xr = c * dx + s * dy
        yr = -s * dx + c * dy
        xrs.append(xr)
        yrs.append(yr)
    a0 = max(abs(x) for x in xrs) or 1.0
    b0 = max(abs(y) for y in yrs) or 1.0
    # Refine: geometric mean of r_ell = sqrt((xr/a)^2+(yr/b)^2) should be 1
    rs = [
        math.sqrt((xr / a0) ** 2 + (yr / b0) ** 2)
        for xr, yr in zip(xrs, yrs)
    ]
    mean_r = sum(rs) / max(len(rs), 1)
    if mean_r < 1e-6:
        mean_r = 1.0
    sa = a0 * mean_r
    sb = b0 * mean_r
    # Keep angle from free fit (outer ring orientation)
    return cx, cy, float(sa), float(sb), float(ang)


def fit_board_ellipse(
    frame_bgr: np.ndarray,
    center_hint: Optional[Tuple[float, float]] = None,
    radius_hint: Optional[float] = None,
) -> Optional[Tuple[float, float, float, float, float]]:
    """
    Best-effort auto ellipse (often imperfect). Prefer click-fit for real use.
    Returns (cx, cy, semi_a, semi_b, angle_deg) or None.
    """
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    blur = cv2.GaussianBlur(gray, (9, 9), 0)

    # Multi-scale edges — dartboard outer ring is usually high-contrast
    edges = np.zeros_like(gray)
    for lo, hi in ((30, 90), (50, 150), (80, 200)):
        e = cv2.Canny(blur, lo, hi)
        edges = cv2.bitwise_or(edges, e)

    if center_hint and radius_hint and radius_hint > 20:
        mask = np.zeros_like(edges)
        cx, cy = int(center_hint[0]), int(center_hint[1])
        r = int(radius_hint)
        # Ring band only (outer double region)
        cv2.circle(mask, (cx, cy), int(r * 1.15), 255, -1)
        cv2.circle(mask, (cx, cy), max(int(r * 0.75), 10), 0, -1)
        edges = cv2.bitwise_and(edges, mask)

    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    pts = cv2.findNonZero(edges)
    if pts is not None and len(pts) >= 80:
        try:
            (ecx, ecy), (ma, mi), ang = cv2.fitEllipse(pts)
            sa, sb = ma / 2.0, mi / 2.0
            if sa > 25 and sb > 25:
                ratio = max(sa, sb) / max(min(sa, sb), 1e-3)
                if ratio < 2.8:
                    if center_hint:
                        d = math.hypot(ecx - center_hint[0], ecy - center_hint[1])
                        if radius_hint is None or d < radius_hint * 0.4:
                            return float(ecx), float(ecy), float(sa), float(sb), float(ang)
                    else:
                        return float(ecx), float(ecy), float(sa), float(sb), float(ang)
        except cv2.error:
            pass

    # Contour-based
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    best = None
    best_score = -1.0
    for cnt in contours:
        if len(cnt) < 50:
            continue
        area = cv2.contourArea(cnt)
        if area < (min(h, w) ** 2) * 0.03:
            continue
        try:
            ell = cv2.fitEllipse(cnt)
        except cv2.error:
            continue
        (ecx, ecy), (ma, mi), ang = ell
        sa, sb = ma / 2.0, mi / 2.0
        if sa < 30 or sb < 30:
            continue
        ratio = max(sa, sb) / max(min(sa, sb), 1e-3)
        if ratio > 2.5:
            continue
        peri = cv2.arcLength(cnt, True)
        circularity = 4 * math.pi * area / max(peri * peri, 1e-3)
        score = math.sqrt(sa * sb) * circularity / max(ratio, 1.0)
        if center_hint and radius_hint:
            d = math.hypot(ecx - center_hint[0], ecy - center_hint[1])
            if d > radius_hint * 0.35:
                continue
            score *= 1.0 / (1.0 + abs(max(sa, sb) - radius_hint) / max(radius_hint, 1))
        if score > best_score:
            best_score = score
            best = (float(ecx), float(ecy), float(sa), float(sb), float(ang))
    if best is not None:
        return best

    # Circle fallback
    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=min(h, w) // 4,
        param1=100,
        param2=40,
        minRadius=min(h, w) // 10,
        maxRadius=min(h, w) // 2,
    )
    if circles is None:
        return None
    c = max(np.round(circles[0, :]).astype(int), key=lambda t: t[2])
    return float(c[0]), float(c[1]), float(c[2]), float(c[2]), 0.0


def ellipse_to_homography(
    cx: float,
    cy: float,
    sa: float,
    sb: float,
    ell_angle_deg: float,
    rotation_deg: float = 0.0,
) -> Optional[List[List[float]]]:
    image_pts = []
    board_angles = (0.0, 90.0, 180.0, 270.0)
    th = math.radians(ell_angle_deg)
    c, s = math.cos(th), math.sin(th)
    for bang in board_angles:
        a_img = math.radians((bang + rotation_deg) % 360.0)
        u = math.sin(a_img)
        v = -math.cos(a_img)
        xr = u * sa
        yr = v * sb
        ix = cx + c * xr - s * yr
        iy = cy + s * xr + c * yr
        image_pts.append((ix, iy))
    return homography_board_to_image(image_pts, board_angles)


def calibration_from_ellipse(
    camera_id: str,
    frame_shape: Tuple[int, int],
    cx: float,
    cy: float,
    sa: float,
    sb: float,
    eang: float,
    rotation_deg: float,
) -> BoardCalibration:
    h, w = frame_shape[:2] if len(frame_shape) >= 2 else (frame_shape[0], frame_shape[0])
    if len(frame_shape) == 3:
        h, w = frame_shape[0], frame_shape[1]
    H = ellipse_to_homography(cx, cy, sa, sb, eang, rotation_deg=rotation_deg)
    return BoardCalibration(
        camera_id=camera_id,
        center_x=float(cx),
        center_y=float(cy),
        radius_px=float(math.sqrt(sa * sb)),
        rotation_deg=float(rotation_deg),
        ellipse_a=float(sa),
        ellipse_b=float(sb),
        ellipse_angle_deg=float(eang),
        axis_x=float(sa),
        axis_y=float(sb),
        H_board_to_image=H,
        image_width=int(w),
        image_height=int(h),
        model="homography" if H is not None else "ellipse",
    )


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
    Build calib. Auto ellipse only accepted if it looks sane; otherwise circle.
    """
    h, w = frame_bgr.shape[:2]
    ell = None
    if force_ellipse:
        ell = fit_board_ellipse(
            frame_bgr, center_hint=(center_x, center_y), radius_hint=radius_px
        )
    if ell is not None:
        ecx, ecy, sa, sb, eang = ell
        # Reject garbage fits (common with dartboard wire clutter)
        ratio = max(sa, sb) / max(min(sa, sb), 1e-3)
        d_center = math.hypot(ecx - center_x, ecy - center_y)
        r_err = abs(math.sqrt(sa * sb) - radius_px) / max(radius_px, 1)
        if ratio < 2.2 and d_center < radius_px * 0.25 and r_err < 0.35:
            return calibration_from_ellipse(
                camera_id, frame_bgr.shape, ecx, ecy, sa, sb, eang, rotation_deg
            )
        # weak fit — still use ellipse center/size lightly if close
        if ratio < 2.0 and d_center < radius_px * 0.4:
            return calibration_from_ellipse(
                camera_id,
                frame_bgr.shape,
                0.5 * center_x + 0.5 * ecx,
                0.5 * center_y + 0.5 * ecy,
                sa,
                sb,
                eang,
                rotation_deg,
            )

    return BoardCalibration(
        camera_id=camera_id,
        center_x=float(center_x),
        center_y=float(center_y),
        radius_px=float(radius_px),
        rotation_deg=float(rotation_deg),
        image_width=w,
        image_height=h,
        model="circle",
    )


def _draw_calib_overlay(
    vis: np.ndarray,
    cx: Optional[float],
    cy: Optional[float],
    sa: Optional[float],
    sb: Optional[float],
    eang: float,
    rot: float,
    pts: List[Tuple[float, float]],
    mx: int,
    my: int,
    status: str,
) -> None:
    for i, (px, py) in enumerate(pts):
        cv2.circle(vis, (int(px), int(py)), 5, (0, 255, 255), -1)
        cv2.putText(
            vis,
            str(i + 1),
            (int(px) + 6, int(py) - 6),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (0, 255, 255),
            1,
        )
    cv2.drawMarker(vis, (mx, my), (255, 255, 0), cv2.MARKER_CROSS, 18, 1)

    if cx is not None and cy is not None:
        cv2.circle(vis, (int(cx), int(cy)), 5, (0, 255, 0), -1)
        if sa and sb:
            cv2.ellipse(
                vis,
                ((float(cx), float(cy)), (float(sa) * 2, float(sb) * 2), float(eang)),
                (0, 200, 255),
                2,
            )
            # sample ticks at board angles for visual check
            th = math.radians(eang)
            c, s = math.cos(th), math.sin(th)
            for bang, label in ((0, "20"), (90, "6"), (180, "3"), (270, "11")):
                a = math.radians((bang + rot) % 360.0)
                u, v = math.sin(a), -math.cos(a)
                xr, yr = u * sa, v * sb
                ix = int(cx + c * xr - s * yr)
                iy = int(cy + s * xr + c * yr)
                cv2.circle(vis, (ix, iy), 4, (255, 128, 0), -1)
                if label == "20":
                    cv2.line(vis, (int(cx), int(cy)), (ix, iy), (0, 255, 0), 2)
                    cv2.putText(
                        vis, "20", (ix + 8, iy), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2
                    )
        else:
            # circle only
            r = int(sa or 0)
            if r > 0:
                cv2.circle(vis, (int(cx), int(cy)), r, (0, 200, 255), 2)

    lines = [
        status,
        f"points={len(pts)}  bull/center=({cx},{cy})  rot={rot:.1f}",
        "1) B = click BULLSEYE first  2) click outer double 8+ times  3) F=fit",
        "T=mark 20  U=undo  C=clear  S=save  Q=quit",
    ]
    y0 = 24
    for line in lines:
        cv2.putText(vis, line, (10, y0), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (20, 20, 20), 3)
        cv2.putText(vis, line, (10, y0), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (240, 240, 240), 1)
        y0 += 22


def interactive_calibrate(
    source: int | str,
    camera_id: str = "cam0",
    out_path: str | Path = "./calib/cam0.json",
) -> BoardCalibration:
    """
    Reliable oblique-camera calibration by clicking the outer double wire.

    Keys:
      click – add point on OUTER DOUBLE (aim for ring around board)
      f     – fit ellipse to clicked points (need ≥5, prefer 8–12)
      t     – set 20-direction to current mouse
      u     – undo last point
      c     – clear points
      a     – auto-fit from edges (often imperfect)
      s     – save
      q     – quit
    """
    cap = _open_source(source)
    state: dict[str, Any] = {
        "pts": [],
        "cx": None,
        "cy": None,
        "sa": None,
        "sb": None,
        "eang": 0.0,
        "rot": 0.0,
        "mx": 0,
        "my": 0,
        "status": "Click 8+ points ON the outer double wire, then press F",
    }

    def on_mouse(event, x, y, flags, param):  # noqa: ARG001
        state["mx"], state["my"] = x, y
        if event == cv2.EVENT_LBUTTONDOWN:
            state["pts"].append((float(x), float(y)))
            state["status"] = f"Point {len(state['pts'])} added — need 5+ then F to fit"

    win = f"No3 Calibrate – {camera_id}  (CLICK outer double)"
    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)

    print(
        "\n=== CLICK-FIT calibration (best for angled cameras) ===\n"
        "  1. Move mouse to the BULLSEYE (dead center of board), press B\n"
        "  2. Click 8–12 points around the OUTER DOUBLE wire\n"
        "  3. Press F to fit — ellipse should hug outer double, green dot on bull\n"
        "  4. Move mouse to middle of the 20 segment, press T\n"
        "  5. Press S to save\n"
        "  U=undo  C=clear  A=auto  Q=quit\n"
        "  If bull is still wrong after F: put mouse on bull, press B again, then F\n"
    )
    state["status"] = "Step 1: mouse on BULLSEYE, press B"

    calib: Optional[BoardCalibration] = None
    last_frame = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        last_frame = frame
        vis = frame.copy()
        h, w = vis.shape[:2]
        _draw_calib_overlay(
            vis,
            state["cx"],
            state["cy"],
            state["sa"],
            state["sb"],
            state["eang"],
            state["rot"],
            state["pts"],
            state["mx"],
            state["my"],
            state["status"],
        )
        cv2.imshow(win, vis)
        key = cv2.waitKey(1) & 0xFF

        if key == ord("b"):
            # Explicit bullseye — do this first; F will lock center here
            state["cx"] = float(state["mx"])
            state["cy"] = float(state["my"])
            state["status"] = (
                f"BULL set at ({state['cx']:.0f},{state['cy']:.0f}) — "
                f"now click outer double 8+ times, then F"
            )
            print(state["status"])
            # If we already have points, refit axes around new bull
            if len(state["pts"]) >= 5:
                ell = fit_ellipse_from_points(
                    state["pts"], fixed_center=(state["cx"], state["cy"])
                )
                if ell is not None:
                    state["cx"], state["cy"], state["sa"], state["sb"], state["eang"] = ell
                    state["status"] = (
                        f"BULL + refit OK — check green dot is on bullseye, then T on 20"
                    )
        elif key == ord("u"):
            if state["pts"]:
                state["pts"].pop()
                state["status"] = f"Undid point — {len(state['pts'])} left"
        elif key == ord("c"):
            state["pts"] = []
            state["cx"] = state["cy"] = state["sa"] = state["sb"] = None
            state["status"] = "Cleared — press B on bullseye, then click outer double"
        elif key == ord("f"):
            fixed = None
            if state["cx"] is not None and state["cy"] is not None:
                fixed = (float(state["cx"]), float(state["cy"]))
            ell = fit_ellipse_from_points(state["pts"], fixed_center=fixed)
            if ell is None:
                state["status"] = "Need B on bullseye + at least 5 outer-double points, then F"
                print(state["status"])
            else:
                state["cx"], state["cy"], state["sa"], state["sb"], state["eang"] = ell
                state["status"] = (
                    f"FIT OK  bull=({ell[0]:.0f},{ell[1]:.0f}) "
                    f"axes=({ell[2]:.0f},{ell[3]:.0f}) — press T on 20, then S"
                )
                print(state["status"])
        elif key == ord("a"):
            if last_frame is None:
                continue
            hint_c = (
                (state["cx"], state["cy"])
                if state["cx"] is not None
                else (w / 2, h / 2)
            )
            hint_r = state["sa"] or min(w, h) * 0.3
            ell = fit_board_ellipse(last_frame, center_hint=hint_c, radius_hint=hint_r)
            if ell is None:
                state["status"] = "Auto fit failed — use B + clicks + F instead"
            else:
                # Keep user bull if already set
                if state["cx"] is not None and state["cy"] is not None:
                    _, _, sa, sb, eang = ell
                    state["sa"], state["sb"], state["eang"] = sa, sb, eang
                    state["status"] = "Auto size only — bull kept; press F if you have points"
                else:
                    state["cx"], state["cy"], state["sa"], state["sb"], state["eang"] = ell
                    state["status"] = "Auto fit — VERIFY bull with B if green dot is wrong"
                print(state["status"])
        elif key == ord("t"):
            if state["cx"] is None:
                state["status"] = "Set bull (B) and fit (F) before setting 20"
            else:
                dx = state["mx"] - state["cx"]
                dy = state["my"] - state["cy"]
                img_ang = math.degrees(math.atan2(dx, -dy)) % 360.0
                if state["sa"] and state["sb"]:
                    th = math.radians(state["eang"])
                    c, s = math.cos(th), math.sin(th)
                    xr = c * dx + s * dy
                    yr = -s * dx + c * dy
                    u = xr / max(state["sa"], 1e-6)
                    v = yr / max(state["sb"], 1e-6)
                    board_img = math.degrees(math.atan2(u, -v)) % 360.0
                    state["rot"] = board_img
                else:
                    state["rot"] = img_ang
                state["status"] = f"20 set at rot={state['rot']:.1f}° — press S to save"
                print(state["status"])
        elif key == ord("s"):
            if state["cx"] is None or not state["sa"] or not state["sb"]:
                state["status"] = "Need B (bull) + F (fit) before save"
                print(state["status"])
                continue
            calib = calibration_from_ellipse(
                camera_id,
                (h, w),
                float(state["cx"]),
                float(state["cy"]),
                float(state["sa"]),
                float(state["sb"]),
                float(state["eang"]),
                float(state["rot"]),
            )
            calib.save(out_path)
            # debug image
            snap = Path(out_path).with_suffix(".jpg")
            cv2.imwrite(str(snap), vis)
            print(f"Saved {out_path}  model={calib.model}  preview={snap}")
            state["status"] = f"SAVED {out_path}"
            break
        elif key == ord("q") or key == 27:
            break

    cap.release()
    cv2.destroyAllWindows()
    if calib is None:
        raise SystemExit("Calibration cancelled — no file saved")
    return calib


def auto_detect_board_circle(frame_bgr: np.ndarray) -> Optional[Tuple[float, float, float]]:
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
