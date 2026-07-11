"""
Standard dartboard polar geometry → scoring segments.

Board radii are normalized 0–1 from center (bull → outer double wire).
Values approximate WDF / PDC proportions used by open CV scorers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Literal, Optional, Tuple

import math

# Clockwise from top (20), 18° per segment — standard board wire order
BOARD_ORDER: Tuple[int, ...] = (
    20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5
)

# Normalized radii (fraction of double-outer radius)
R_BULL = 0.066   # double bull
R_OUTER_BULL = 0.16
R_TRIPLE_INNER = 0.58
R_TRIPLE_OUTER = 0.63
R_DOUBLE_INNER = 0.95
R_DOUBLE_OUTER = 1.0

SegmentKind = Literal["single", "double", "triple", "outer_bull", "bull", "miss"]


@dataclass(frozen=True)
class SegmentHit:
    kind: SegmentKind
    number: int
    value: int
    angle_deg: float  # 0 = top (20), clockwise
    radius: float     # 0–1+
    confidence: float


def segment_value(kind: SegmentKind, number: int) -> int:
    if kind == "miss":
        return 0
    if kind == "outer_bull":
        return 25
    if kind == "bull":
        return 50
    if kind == "single":
        return number
    if kind == "double":
        return number * 2
    if kind == "triple":
        return number * 3
    return 0


def number_at_angle(angle_deg: float) -> int:
    """
    Map angle to board number.
    angle_deg: 0 at top (center of 20), increasing clockwise.
    """
    a = angle_deg % 360.0
    # Segment centers at i*18; boundaries at i*18 ± 9
    idx = int((a + 9.0) // 18.0) % 20
    return BOARD_ORDER[idx]


def angle_for_number(number: int) -> float:
    try:
        idx = BOARD_ORDER.index(number)
    except ValueError as e:
        raise ValueError(f"Invalid board number {number}") from e
    return idx * 18.0


def polar_to_segment(
    radius: float,
    angle_deg: float,
    *,
    confidence: float = 1.0,
    miss_outside: bool = True,
) -> SegmentHit:
    """
    Convert polar board coords (radius 0–1 at double outer wire) to a segment.

    radius > 1.05 → miss (if miss_outside)
    """
    r = max(0.0, float(radius))
    ang = float(angle_deg) % 360.0

    # Small epsilon so float r≈1.0 still scores as double (not miss)
    R_MISS = 1.06

    if miss_outside and r > R_MISS:
        return SegmentHit("miss", 0, 0, ang, r, confidence * 0.5)

    if r <= R_BULL:
        return SegmentHit("bull", 50, 50, ang, r, confidence)
    if r <= R_OUTER_BULL:
        return SegmentHit("outer_bull", 25, 25, ang, r, confidence)

    num = number_at_angle(ang)

    if R_TRIPLE_INNER <= r <= R_TRIPLE_OUTER:
        kind: SegmentKind = "triple"
    elif R_DOUBLE_INNER <= r <= R_DOUBLE_OUTER + 0.04:
        # include slightly outside wire as double (float / tip error)
        kind = "double"
    elif r < R_TRIPLE_INNER or (R_TRIPLE_OUTER < r < R_DOUBLE_INNER):
        kind = "single"
    else:
        if miss_outside:
            return SegmentHit("miss", 0, 0, ang, r, confidence * 0.6)
        kind = "double"

    return SegmentHit(kind, num, segment_value(kind, num), ang, r, confidence)


def pixel_to_polar(
    x: float,
    y: float,
    center_x: float,
    center_y: float,
    radius_px: float,
    rotation_deg: float = 0.0,
) -> Tuple[float, float]:
    """
    Image pixel → (radius_norm, angle_deg) assuming a **circular** board
    (nadir / face-on camera). For oblique cams use pixel_to_polar_ellipse
    or pixel_to_polar_homography instead.

    Image coords: x right, y down.
    Board angle: 0 at top (negative Y), clockwise.
    rotation_deg: image→board so that segment 20 is at board angle 0.
    """
    dx = x - center_x
    dy = y - center_y
    ang = math.degrees(math.atan2(dx, -dy)) % 360.0
    ang = (ang - rotation_deg) % 360.0
    r = math.hypot(dx, dy) / max(radius_px, 1e-6)
    return r, ang


def pixel_to_polar_ellipse(
    x: float,
    y: float,
    center_x: float,
    center_y: float,
    axis_a: float,
    axis_b: float,
    ellipse_angle_deg: float,
    rotation_deg: float = 0.0,
) -> Tuple[float, float]:
    """
    Oblique-camera model: outer double is an **ellipse** in the image
    (perspective of a real circle). Map pixel → unit-disk board coords.

    OpenCV fitEllipse style:
      center (cx,cy), axes (a,b) as full widths OR we use semi-axes —
      we store **semi-axes** (half of OpenCV width/height).
      ellipse_angle_deg: rotation of the ellipse (OpenCV angle).

    After normalizing onto the unit disk:
      r=1 on outer double, angle 0 at board "up" after rotation_deg.
    """
    a = max(float(axis_a), 1e-6)
    b = max(float(axis_b), 1e-6)
    dx = float(x) - float(center_x)
    dy = float(y) - float(center_y)
    # Rotate into ellipse axis frame (OpenCV angle is degrees, CCW from +x)
    th = math.radians(float(ellipse_angle_deg))
    c, s = math.cos(th), math.sin(th)
    # Inverse rotation of point into ellipse-aligned coords
    xr = c * dx + s * dy
    yr = -s * dx + c * dy
    u = xr / a
    v = yr / b
    # Unit disk: angle from top (0,-1 in image-like v-down), clockwise
    ang = math.degrees(math.atan2(u, -v)) % 360.0
    ang = (ang - rotation_deg) % 360.0
    r = math.hypot(u, v)
    return r, ang


def pixel_to_polar_homography(
    x: float,
    y: float,
    H_inv: List[List[float]] | Tuple | object,
    rotation_deg: float = 0.0,
) -> Tuple[float, float]:
    """
    Full perspective: map image pixel through inverse homography to board
    plane where outer double is the unit circle centered at origin,
    +Y_board is "up" toward 20 before rotation_deg.
    """
    # H_inv maps image → board (3x3 row-major or nested)
    import numpy as np

    M = np.asarray(H_inv, dtype=np.float64).reshape(3, 3)
    p = M @ np.array([x, y, 1.0], dtype=np.float64)
    if abs(p[2]) < 1e-9:
        return 99.0, 0.0
    bx, by = float(p[0] / p[2]), float(p[1] / p[2])
    # Board plane: +x right, +y up (20). Image-like y-down would be -by for atan2.
    ang = math.degrees(math.atan2(bx, by)) % 360.0  # 0 at +y (up), clockwise? atan2(x,y): 0 at +y, increases toward +x = CW if y up
    # atan2(bx, by): 0 when bx=0,by>0 (up); positive bx → angle increases → clockwise from up. Good.
    ang = (ang - rotation_deg) % 360.0
    r = math.hypot(bx, by)
    return r, ang


def homography_board_to_image(
    image_points: list[Tuple[float, float]],
    board_angles_deg: Tuple[float, ...] = (0.0, 90.0, 180.0, 270.0),
) -> Optional[List[List[float]]]:
    """
    Build board→image homography from ≥4 image points on the OUTER DOUBLE
    at known board angles (default: 20/top, 6, 3, 11 o'clock positions).

    Board plane: unit circle, angle 0 at +Y (20), clockwise.
    Returns 3x3 list (board→image) or None.
    """
    if len(image_points) < 4:
        return None
    try:
        import numpy as np
        import cv2
    except ImportError:
        return None

    src = []
    dst = []
    for i, (ix, iy) in enumerate(image_points[:4]):
        ang = math.radians(board_angles_deg[i % len(board_angles_deg)])
        # board: 0° at +Y, clockwise → x = sin, y = cos
        bx = math.sin(ang)
        by = math.cos(ang)
        src.append([bx, by])
        dst.append([ix, iy])
    src_a = np.float32(src)
    dst_a = np.float32(dst)
    H, _ = cv2.findHomography(src_a, dst_a, method=0)
    if H is None:
        return None
    return H.tolist()


def fuse_hits(hits: list[SegmentHit], min_confidence: float = 0.4) -> SegmentHit | None:
    """
    Combine multi-camera votes. Majority on (kind, number); confidence = mean of voters.
    """
    usable = [h for h in hits if h.confidence >= min_confidence and h.kind != "miss"]
    if not usable:
        misses = [h for h in hits if h.kind == "miss"]
        if misses:
            return max(misses, key=lambda h: h.confidence)
        return None

    from collections import Counter

    keys = [(h.kind, h.number) for h in usable]
    (best_kind, best_num), count = Counter(keys).most_common(1)[0]
    voters = [h for h in usable if h.kind == best_kind and h.number == best_num]
    conf = sum(h.confidence for h in voters) / len(voters)
    # boost if multi-cam agree
    if count >= 2:
        conf = min(1.0, conf + 0.15)
    # average polar for heatmaps
    ang = sum(h.angle_deg for h in voters) / len(voters)
    rad = sum(h.radius for h in voters) / len(voters)
    return SegmentHit(best_kind, best_num, segment_value(best_kind, best_num), ang, rad, conf)
