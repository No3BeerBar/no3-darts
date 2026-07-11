"""
Standard dartboard polar geometry → scoring segments.

Board radii are normalized 0–1 from center (bull → outer double wire).
Values approximate WDF / PDC proportions used by open CV scorers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Tuple

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

    if miss_outside and r > 1.05:
        return SegmentHit("miss", 0, 0, ang, r, confidence * 0.5)

    if r <= R_BULL:
        return SegmentHit("bull", 50, 50, ang, r, confidence)
    if r <= R_OUTER_BULL:
        return SegmentHit("outer_bull", 25, 25, ang, r, confidence)

    num = number_at_angle(ang)

    if R_TRIPLE_INNER <= r <= R_TRIPLE_OUTER:
        kind: SegmentKind = "triple"
    elif R_DOUBLE_INNER <= r <= R_DOUBLE_OUTER:
        kind = "double"
    elif r < R_TRIPLE_INNER or (R_TRIPLE_OUTER < r < R_DOUBLE_INNER):
        kind = "single"
    else:
        # slightly past double wire
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
    Image pixel → (radius_norm, angle_deg).

    Image coords: x right, y down.
    Board angle: 0 at top (negative Y), clockwise.
    rotation_deg: calibration offset so that '20' is at the top of the board
                  in the real world (degrees clockwise from image-up).
    """
    dx = x - center_x
    dy = y - center_y
    # angle from top, clockwise
    # atan2(dx, -dy): 0 when pointing up
    ang = math.degrees(math.atan2(dx, -dy)) % 360.0
    ang = (ang - rotation_deg) % 360.0
    r = math.hypot(dx, dy) / max(radius_px, 1e-6)
    return r, ang


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
