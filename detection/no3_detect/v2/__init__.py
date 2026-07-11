"""
Detection v2 — Autodarts / DeepDarts style geometry.

4-point homography to board plane → tip detect → multi-cam fuse → score.
"""

from .board_plane import board_xy_to_hit, ideal_calib_points
from .cam_calib import CamCalib

__all__ = ["board_xy_to_hit", "ideal_calib_points", "CamCalib"]
