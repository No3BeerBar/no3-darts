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
from typing import List, Tuple

from ..board_geometry import BOARD_ORDER, SegmentHit, polar_to_segment, segment_value

# DeepDarts / standard 4 calibration points on OUTER DOUBLE
# at wire intersections: 20-5, 6-13, 3-17, 11-8
CALIB_LABELS = (
    "20/5 wire (TOP of board)",
    "6/13 wire (RIGHT)",
    "3/17 wire (BOTTOM)",
    "11/8 wire (LEFT)",
)

# Board angles (deg, 0=20 center, clockwise) of those wire midpoints
# Wires sit halfway between segment centers: 20@0 → wire 20/5 at 9°? 
# Segment centers every 18°. Wire between 20 (0°) and 1 (18°) is at 9°.
# DeepDarts says intersections of 5-20, 13-6, 17-3, 8-11 on outer double.
# Segment angles: 20=0, 1=18, 18=36, 4=54, 13=72, 6=90, 10=108, 15=126, 2=144,
# 17=162, 3=180, 19=198, 7=216, 16=234, 8=252, 11=270, 14=288, 9=306, 12=324, 5=342
# Wire 20/5: between 20(0) and 5(342) → midpoint at (0+342)/2 ... better:
# wire between n and next clockwise: center_n + 9°
# 20→1 wire at 9°, 5→20 wire at 342+9=351°
# DeepDarts "5 and 20" intersection on outer ring is the wire separating 5 and 20 = 351°
# Practically Autodarts-style "top" point is often taken at 20 double center (0°)
# for simplicity of user aiming. We use segment-center outer double at 0,90,180,270
# which is easier to click (middle of double-20, double-6, double-3, double-11).

# User-facing: click middle of OUTER DOUBLE on segments 20, 6, 3, 11
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
        # 0° at +Y, clockwise: x = sin, y = cos
        pts.append((math.sin(a), math.cos(a)))
    return pts


def board_xy_to_polar(x: float, y: float) -> Tuple[float, float]:
    """Board (x,y) → (r, angle_deg) with 0° at +Y (20), clockwise."""
    r = math.hypot(x, y)
    ang = math.degrees(math.atan2(x, y)) % 360.0
    return r, ang


def board_xy_to_hit(x: float, y: float, confidence: float = 1.0) -> SegmentHit:
    r, ang = board_xy_to_polar(x, y)
    return polar_to_segment(r, ang, confidence=confidence)


@dataclass
class BoardPoint:
    x: float
    y: float
    confidence: float = 1.0
    camera_id: str = ""

    def to_hit(self) -> SegmentHit:
        return board_xy_to_hit(self.x, self.y, self.confidence)


def fuse_board_points(
    points: List[BoardPoint],
    min_confidence: float = 0.35,
) -> BoardPoint | None:
    """Average board-plane positions (true multi-cam fusion)."""
    usable = [p for p in points if p.confidence >= min_confidence]
    if not usable:
        return None
    wsum = sum(max(p.confidence, 0.05) for p in usable)
    x = sum(p.x * max(p.confidence, 0.05) for p in usable) / wsum
    y = sum(p.y * max(p.confidence, 0.05) for p in usable) / wsum
    conf = sum(p.confidence for p in usable) / len(usable)
    if len(usable) >= 2:
        conf = min(1.0, conf + 0.1)
    return BoardPoint(x=x, y=y, confidence=conf, camera_id="fused")
