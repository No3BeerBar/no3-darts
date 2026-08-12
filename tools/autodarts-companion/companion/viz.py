"""Live OpenCV board diagram fed by Autodarts throws."""

from __future__ import annotations

import math
import time
from typing import Any, List, Tuple

import cv2
import numpy as np
from rich.console import Console

from .client import AutodartsClient, extract_throws, format_dart, throws_signature

console = Console()

BOARD_ORDER = (20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5)


def _draw_board(size: int = 700) -> np.ndarray:
    img = np.zeros((size, size, 3), dtype=np.uint8)
    img[:] = (25, 25, 28)
    c = size // 2
    R = int(size * 0.42)
    # rings (approx)
    for frac, col in (
        (1.0, (80, 80, 90)),
        (0.95, (60, 60, 70)),
        (0.63, (80, 80, 90)),
        (0.58, (60, 60, 70)),
        (0.16, (40, 100, 40)),
        (0.066, (40, 40, 160)),
    ):
        cv2.circle(img, (c, c), int(R * frac), col, 2)
    for i, num in enumerate(BOARD_ORDER):
        a = math.radians(i * 18)
        # wire at +/-9 deg
        for da in (-9, 9):
            ang = math.radians(i * 18 + da)
            x = int(c + R * math.sin(ang))
            y = int(c - R * math.cos(ang))
            cv2.line(img, (c, c), (x, y), (50, 50, 55), 1)
        # label
        ang = math.radians(i * 18)
        lx = int(c + (R + 28) * math.sin(ang))
        ly = int(c - (R + 28) * math.cos(ang))
        cv2.putText(
            img,
            str(num),
            (lx - 12, ly + 6),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (200, 200, 200),
            1,
        )
    return img


def _seg_to_xy(label: str, R: float) -> Tuple[float, float]:
    """Rough board-plane position from score label for viz only."""
    lab = label.upper().strip()
    mult = 1
    num = 0
    if lab in ("BULL", "DBULL", "50", "D25"):
        return 0.0, 0.0
    if lab in ("25", "SBULL", "OUTER"):
        return 0.0, 0.12 * R
    if lab.startswith("T"):
        mult, num = 3, int(lab[1:] or 0)
    elif lab.startswith("D"):
        mult, num = 2, int(lab[1:] or 0)
    elif lab.startswith("S"):
        mult, num = 1, int(lab[1:] or 0)
    else:
        try:
            num = int(lab)
        except ValueError:
            return 0.0, 0.0
    try:
        idx = BOARD_ORDER.index(num)
    except ValueError:
        return 0.0, 0.0
    ang = math.radians(idx * 18)
    if mult == 3:
        r = 0.605
    elif mult == 2:
        r = 0.975
    else:
        r = 0.4
    return r * R * math.sin(ang), -r * R * math.cos(ang)


def run_viz(host: str, port: int, poll_ms: int = 300) -> None:
    client = AutodartsClient(host, port)
    base = _draw_board()
    size = base.shape[0]
    c = size // 2
    R = size * 0.42
    pins: List[Tuple[int, int, str]] = []
    last_sig = ""
    console.print(f"Viz connected to http://{host}:{port} - throw darts. Q to quit.")

    while True:
        try:
            state = client.state()
            throws = extract_throws(state)
            sig = throws_signature(throws)
            if sig != last_sig:
                pins.clear()
                for d in throws:
                    lab = format_dart(d)
                    x, y = _seg_to_xy(lab, R)
                    pins.append((int(c + x), int(c + y), lab))
                last_sig = sig
        except Exception as e:
            cv2.putText(
                base,
                f"AD offline: {e}"[:60],
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 0, 255),
                2,
            )

        vis = base.copy()
        status = ""
        try:
            status = str(state.get("status", ""))  # type: ignore[name-defined]
        except Exception:
            pass
        cv2.putText(
            vis,
            f"Autodarts {status}  hits={len(pins)}",
            (16, size - 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (180, 180, 180),
            1,
        )
        for i, (x, y, lab) in enumerate(pins):
            cv2.circle(vis, (x, y), 10, (0, 255, 255), 2)
            cv2.putText(
                vis,
                f"{i+1}:{lab}",
                (x + 12, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 255),
                1,
            )

        cv2.imshow("Autodarts companion board", vis)
        key = cv2.waitKey(max(poll_ms, 30)) & 0xFF
        if key in (ord("q"), 27):
            break

    cv2.destroyAllWindows()
