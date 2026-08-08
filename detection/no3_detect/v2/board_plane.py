"""
Ideal dartboard plane geometry (WDF proportions).

Board coordinates:
  origin = bull center
  +Y = center of segment 20 (up)
  +X = toward segment 6 (right when facing board)
  outer double edge at radius 1.0
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional, Tuple

from ..board_geometry import polar_to_segment

CALIB_BOARD_ANGLES = (0.0, 90.0, 180.0, 270.0)
CALIB_CLICK_HINTS = (
    "Click OUTER DOUBLE in the middle of segment 20 (top of board)",
    "Click OUTER DOUBLE in the middle of segment 6 (right)",
    "Click OUTER DOUBLE in the middle of segment 3 (bottom)",
    "Click OUTER DOUBLE in the middle of segment 11 (left)",
)


def ideal_calib_points() -> List[Tuple[float, float]]:
    """Destination points in board plane for the 4 calib clicks (r=1)."""
    pts = []
    for ang in CALIB_BOARD_ANGLES:
        a = math.radians(ang)
        pts.append((math.sin(a), math.cos(a)))
    return pts


def board_xy_to_polar(x: float, y: float) -> Tuple[float, float]:
    """Board (x,y) → (r, angle_deg) with 0° at +Y (20), clockwise."""
    r = math.hypot(x, y)
    ang = math.degrees(math.atan2(x, y)) % 360.0
    return r, ang


def board_xy_to_hit(x: float, y: float, confidence: float = 1.0):
    r, ang = board_xy_to_polar(x, y)
    return polar_to_segment(r, ang, confidence=confidence)


@dataclass
class BoardPoint:
    x: float
    y: float
    confidence: float = 1.0
    camera_id: str = ""

    def to_hit(self):
        return board_xy_to_hit(self.x, self.y, self.confidence)

    def dist(self, other: "BoardPoint") -> float:
        return math.hypot(self.x - other.x, self.y - other.y)


def fuse_board_points(
    points: List[BoardPoint],
    min_confidence: float = 0.35,
    max_pair_dist: float = 0.22,
    require_cams: int = 1,
) -> Optional[BoardPoint]:
    """
    Robust multi-cam fusion in board plane.

    - Drop low-confidence tips
    - If 2+ cams: reject outliers far from the median
    - Weighted mean of remaining; boost conf when cams agree
    """
    usable = [p for p in points if p.confidence >= min_confidence]
    if len(usable) < require_cams:
        return None
    if not usable:
        return None

    if len(usable) == 1:
        return usable[0]

    # Geometric median approximation: iterative Weiszfeld-lite
    x = sum(p.x for p in usable) / len(usable)
    y = sum(p.y for p in usable) / len(usable)
    for _ in range(8):
        num_x = num_y = den = 0.0
        for p in usable:
            d = math.hypot(p.x - x, p.y - y) + 1e-6
            w = p.confidence / d
            num_x += w * p.x
            num_y += w * p.y
            den += w
        x, y = num_x / den, num_y / den

    center = BoardPoint(x, y, 1.0, "med")
    kept = [p for p in usable if p.dist(center) <= max_pair_dist]
    if len(kept) < require_cams:
        # fall back to best single cam
        return max(usable, key=lambda p: p.confidence)

    wsum = sum(max(p.confidence, 0.05) for p in kept)
    fx = sum(p.x * max(p.confidence, 0.05) for p in kept) / wsum
    fy = sum(p.y * max(p.confidence, 0.05) for p in kept) / wsum
    conf = sum(p.confidence for p in kept) / len(kept)
    # Agreement boost
    spread = max(p.dist(BoardPoint(fx, fy)) for p in kept)
    if len(kept) >= 2:
        conf = min(0.98, conf + 0.12)
    if len(kept) >= 3:
        conf = min(0.99, conf + 0.05)
    if spread > 0.12:
        conf *= 0.85
    return BoardPoint(x=fx, y=fy, confidence=conf, camera_id="fused")
