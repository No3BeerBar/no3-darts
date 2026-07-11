"""
4-click calibration UI (DeepDarts / Autodarts style).

Click outer double at 20, 6, 3, 11 segment middles → homography → warp check.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

from ..calibration import _open_source
from .board_plane import CALIB_CLICK_HINTS
from .cam_calib import CamCalib


def interactive_calibrate_v2(
    source: int | str,
    camera_id: str = "cam0",
    out_path: str | Path = "./calib/cam0.json",
) -> CamCalib:
    cap = _open_source(source)
    points: List[Tuple[float, float]] = []
    mx, my = 0, 0
    status = CALIB_CLICK_HINTS[0]
    frozen: Optional[np.ndarray] = None

    def on_mouse(event, x, y, flags, param):  # noqa: ARG001
        nonlocal mx, my, points, status, frozen
        mx, my = x, y
        if event == cv2.EVENT_LBUTTONDOWN and len(points) < 4:
            points.append((float(x), float(y)))
            if len(points) < 4:
                status = CALIB_CLICK_HINTS[len(points)]
            else:
                status = "4 points set — press S to save, R to reset, preview should look circular"

    win = f"No3 v2 Calibrate – {camera_id}"
    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)

    print(
        "\n=== v2 4-POINT calibration (Autodarts / DeepDarts style) ===\n"
        "  Click OUTER DOUBLE once for each:\n"
        "    1) middle of 20 (top of REAL board)\n"
        "    2) middle of 6\n"
        "    3) middle of 3\n"
        "    4) middle of 11\n"
        "  Then S=save  R=reset  Q=quit\n"
        "  Good save: orange ring looks ROUND and green bull is on bullseye.\n"
    )

    calib: Optional[CamCalib] = None

    while True:
        if frozen is None:
            ok, frame = cap.read()
            if not ok:
                break
        else:
            frame = frozen.copy()
            ok = True

        h, w = frame.shape[:2]
        vis = frame.copy()
        cv2.drawMarker(vis, (mx, my), (255, 255, 0), cv2.MARKER_CROSS, 20, 1)

        for i, (px, py) in enumerate(points):
            cv2.circle(vis, (int(px), int(py)), 8, (0, 255, 255), 2)
            cv2.putText(
                vis,
                str(i + 1),
                (int(px) + 10, int(py) - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 255),
                2,
            )

        if len(points) == 4:
            try:
                tmp = CamCalib(
                    camera_id=camera_id,
                    image_points=[[p[0], p[1]] for p in points],
                    image_width=w,
                    image_height=h,
                )
                vis = tmp.draw_overlay(frame)
                for i, (px, py) in enumerate(points):
                    cv2.circle(vis, (int(px), int(py)), 8, (0, 255, 255), 2)
            except Exception as e:
                status = f"Homography error: {e}"

        lines = [
            status,
            f"points {len(points)}/4  |  S=save  R=reset  SPACE=freeze frame  Q=quit",
        ]
        y0 = 28
        for line in lines:
            cv2.putText(vis, line, (10, y0), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
            cv2.putText(vis, line, (10, y0), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (240, 240, 240), 1)
            y0 += 24

        cv2.imshow(win, vis)
        key = cv2.waitKey(1) & 0xFF

        if key == ord(" ") and frozen is None:
            ok, frame = cap.read()
            if ok:
                frozen = frame.copy()
                status = "Frame frozen — click 4 points carefully"
        elif key == ord("r"):
            points = []
            frozen = None
            status = CALIB_CLICK_HINTS[0]
        elif key == ord("s"):
            if len(points) != 4:
                status = "Need exactly 4 points"
                continue
            ok, frame = cap.read()
            if frozen is not None:
                frame = frozen
            h, w = frame.shape[:2]
            try:
                calib = CamCalib(
                    camera_id=camera_id,
                    image_points=[[p[0], p[1]] for p in points],
                    image_width=w,
                    image_height=h,
                )
            except Exception as e:
                status = f"Save failed: {e}"
                continue
            # Validate bull roughly inside outer points
            bx, by = calib.board_to_image(0.0, 0.0)
            if not (0 <= bx < w and 0 <= by < h):
                status = "Bull projects off-image — re-click points (order: 20,6,3,11)"
                calib = None
                continue
            calib.save(out_path)
            snap = Path(out_path).with_suffix(".jpg")
            cv2.imwrite(str(snap), calib.draw_overlay(frame))
            print(f"Saved {out_path}  preview {snap}")
            status = f"SAVED {out_path}"
            # brief show
            cv2.imshow(win, calib.draw_overlay(frame))
            cv2.waitKey(800)
            break
        elif key == ord("q") or key == 27:
            break

    cap.release()
    cv2.destroyAllWindows()
    if calib is None:
        raise SystemExit("Calibration cancelled")
    return calib
