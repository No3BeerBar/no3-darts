"""
Fully automatic camera calibration (no mouse clicks).

Pipeline (Autodarts / DeepDarts style landmarks):
  1) Optional Grok vision: return 4 outer-double points at 20, 6, 3, 11
  2) OpenCV fallback: outer ellipse + 4 cardinal points on that ellipse
     (assumes segment 20 is roughly toward image-up; still maps board plane)

Saves v2 CamCalib JSON used by v2-run.
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
from pathlib import Path
from typing import Any, List, Optional, Tuple

import cv2
import numpy as np
import requests
from rich.console import Console

from ..calibration import _open_source, fit_board_ellipse
from .board_plane import CALIB_BOARD_ANGLES, ideal_calib_points
from .cam_calib import CamCalib

console = Console()

DEFAULT_VISION_MODEL = os.environ.get("XAI_VISION_MODEL", "grok-build-0.1")
XAI_RESPONSES_URL = "https://api.x.ai/v1/responses"
XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions"

AUTO_PROMPT = """You are calibrating a steel-tip dartboard camera (often angled/oblique).

Return ONLY valid JSON (no markdown):
{
  "points": [
    {"label": "20", "x": <pixel x on OUTER DOUBLE wire at middle of segment 20>, "y": <pixel y>},
    {"label": "6",  "x": <pixel x on OUTER DOUBLE at middle of segment 6>, "y": <pixel y>},
    {"label": "3",  "x": <pixel x on OUTER DOUBLE at middle of segment 3>, "y": <pixel y>},
    {"label": "11", "x": <pixel x on OUTER DOUBLE at middle of segment 11>, "y": <pixel y>}
  ],
  "bull_x": <bullseye pixel x>,
  "bull_y": <bullseye pixel y>,
  "confidence": <0.0-1.0>
}

Rules:
- All four points must lie on the OUTER DOUBLE scoring ring (outermost thin ring), not on numbers outside the board.
- Order must be 20, 6, 3, 11 around the board (board coordinates, not image-up).
- Origin top-left, x right, y down.
"""


def grab_frame(source: int | str, warm: int = 10) -> np.ndarray:
    cap = _open_source(source)
    frame = None
    for _ in range(warm):
        ok, frame = cap.read()
        if not ok:
            break
    cap.release()
    if frame is None:
        raise RuntimeError(f"Could not grab frame from {source}")
    return frame


def _jpeg_b64(frame_bgr: np.ndarray, max_side: int = 1280) -> Tuple[str, float]:
    """
    Return (base64_jpeg, scale) where scale = sent_size / original_size.
    Grok returns coords in sent image space; multiply by 1/scale for full-res.
    """
    h, w = frame_bgr.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        frame_bgr = cv2.resize(frame_bgr, (int(w * scale), int(h * scale)))
    ok, buf = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii"), float(scale)


def _parse_json_loose(text: str) -> dict[str, Any]:
    text = text.strip()
    if "```" in text:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            text = m.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


def _points_from_grok(
    frame_bgr: np.ndarray, api_key: str, model: str
) -> Optional[List[Tuple[float, float]]]:
    """Return 4 image points (20,6,3,11) or None."""
    h, w = frame_bgr.shape[:2]
    b64, scale = _jpeg_b64(frame_bgr)
    data_url = f"data:image/jpeg;base64,{b64}"
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_image", "image_url": data_url},
                    {"type": "input_text", "text": AUTO_PROMPT},
                ],
            }
        ],
    }
    console.print(f"[cyan]Auto-cal: Grok vision ({model})…[/cyan]")
    try:
        r = requests.post(XAI_RESPONSES_URL, headers=headers, json=body, timeout=90)
        if r.status_code >= 400:
            chat = {
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": data_url}},
                            {"type": "text", "text": AUTO_PROMPT},
                        ],
                    }
                ],
            }
            r = requests.post(XAI_CHAT_URL, headers=headers, json=chat, timeout=90)
        if r.status_code >= 400:
            console.print(
                f"[yellow]Grok auto-cal failed HTTP {r.status_code}: "
                f"{(r.text or '')[:180]}[/yellow]"
            )
            return None
        data = r.json()
        if "choices" in data:
            content = data["choices"][0]["message"]["content"]
        else:
            content = ""
            if isinstance(data.get("output_text"), str):
                content = data["output_text"]
            else:
                for item in data.get("output") or []:
                    if not isinstance(item, dict):
                        continue
                    for part in item.get("content") or []:
                        if isinstance(part, dict) and part.get("type") in (
                            "output_text",
                            "text",
                        ):
                            content += str(part.get("text", ""))
        parsed = _parse_json_loose(str(content))
        pts_raw = parsed.get("points") or []
        by_label = {}
        for p in pts_raw:
            lab = str(p.get("label", "")).strip()
            by_label[lab] = (float(p["x"]), float(p["y"]))
        ordered = []
        # Coords are in the *sent* image; map back to full-res if we scaled
        inv = 1.0 / scale if scale > 1e-9 else 1.0
        for lab in ("20", "6", "3", "11"):
            if lab not in by_label:
                console.print(f"[yellow]Grok missing point {lab}[/yellow]")
                return None
            x, y = by_label[lab]
            x, y = x * inv, y * inv
            if x < -10 or y < -10 or x > w + 10 or y > h + 10:
                console.print(f"[yellow]Grok point {lab} out of bounds ({x:.0f},{y:.0f})[/yellow]")
                return None
            ordered.append((float(np.clip(x, 0, w - 1)), float(np.clip(y, 0, h - 1))))
        conf = float(parsed.get("confidence", 0.7))
        console.print(f"[green]Grok landmarks OK[/green] conf={conf:.2f} scale={scale:.3f}")
        return ordered
    except Exception as e:
        console.print(f"[yellow]Grok auto-cal error: {e}[/yellow]")
        return None


def _ellipse_point(
    cx: float, cy: float, sa: float, sb: float, eang_deg: float, board_angle_deg: float
) -> Tuple[float, float]:
    """
    Point on ellipse at board angle (0=up/20, clockwise), approximating
    image-up as board-up when we don't know rotation yet.
    """
    th = math.radians(eang_deg)
    c, s = math.cos(th), math.sin(th)
    a = math.radians(board_angle_deg)
    # unit direction 0° = up (-y in image before ellipse warp)
    u, v = math.sin(a), -math.cos(a)
    xr, yr = u * sa, v * sb
    ix = cx + c * xr - s * yr
    iy = cy + s * xr + c * yr
    return float(ix), float(iy)


def _points_from_opencv(frame_bgr: np.ndarray) -> Optional[List[Tuple[float, float]]]:
    """
    Fit outer board ellipse and sample 4 cardinals (image-up ≈ 20).
    Good enough when cams are mounted with 20 near the top of each view;
    for strong rotation Grok path is preferred.
    """
    h, w = frame_bgr.shape[:2]
    ell = fit_board_ellipse(frame_bgr, center_hint=(w / 2, h / 2), radius_hint=min(w, h) * 0.35)
    if ell is None:
        # Hough circle fallback
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.medianBlur(gray, 5)
        circles = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=min(h, w) // 3,
            param1=100,
            param2=40,
            minRadius=min(h, w) // 10,
            maxRadius=min(h, w) // 2,
        )
        if circles is None:
            return None
        c = max(np.round(circles[0]).astype(int), key=lambda t: t[2])
        cx, cy, r = float(c[0]), float(c[1]), float(c[2])
        ell = (cx, cy, r, r, 0.0)

    cx, cy, sa, sb, eang = ell
    # Reject tiny / huge
    if sa < 40 or sb < 40:
        return None
    # Estimate "up" along the minor or major axis that points toward top of image
    # Sample ellipse at image angles and pick point with smallest y as "20"
    candidates = []
    for deg in range(0, 360, 3):
        px, py = _ellipse_point(cx, cy, sa, sb, eang, float(deg))
        candidates.append((py, deg, px, py))
    candidates.sort(key=lambda t: t[0])
    top_board_angle = candidates[0][1]

    pts = []
    for off in CALIB_BOARD_ANGLES:
        ang = (top_board_angle + off) % 360.0
        px, py = _ellipse_point(cx, cy, sa, sb, eang, ang)
        pts.append(
            (
                float(np.clip(px, 0, w - 1)),
                float(np.clip(py, 0, h - 1)),
            )
        )
    console.print(
        f"[green]OpenCV ellipse[/green] center=({cx:.0f},{cy:.0f}) "
        f"axes=({sa:.0f},{sb:.0f}) top_angle={top_board_angle:.0f}°"
    )
    return pts


def _validate_calib(calib: CamCalib, w: int, h: int) -> Tuple[bool, str]:
    """Sanity-check homography."""
    try:
        bx, by = calib.board_to_image(0.0, 0.0)
    except Exception as e:
        return False, f"bull project failed: {e}"
    if not (0 <= bx < w and 0 <= by < h):
        return False, "bull projects outside image"
    # outer double points should map near r=1
    for i, ang in enumerate(CALIB_BOARD_ANGLES):
        ix, iy = calib.image_points[i]
        x, y = calib.image_to_board(ix, iy)
        r = math.hypot(x, y)
        if r < 0.75 or r > 1.35:
            return False, f"point {i+1} maps to r={r:.2f} (want ~1)"
    # area of quad not degenerate
    pts = np.float32(calib.image_points[:4])
    area = cv2.contourArea(pts)
    if area < (min(w, h) ** 2) * 0.02:
        return False, "calib points too close together"
    return True, "ok"


def auto_calibrate_camera(
    source: int | str,
    camera_id: str,
    out_path: str | Path,
    *,
    api_key: Optional[str] = None,
    model: str = DEFAULT_VISION_MODEL,
    prefer_grok: bool = True,
    show_preview: bool = True,
    auto_save: bool = True,
) -> CamCalib:
    """
    Capture one frame, auto-find 4 landmarks, save CamCalib.
    No mouse clicks required.
    """
    if isinstance(source, str) and source.isdigit():
        source = int(source)

    frame = grab_frame(source)
    h, w = frame.shape[:2]
    key = (
        api_key
        or os.environ.get("XAI_API_KEY")
        or os.environ.get("GROK_API_KEY")
        or ""
    ).strip()

    points: Optional[List[Tuple[float, float]]] = None
    method_used = ""

    if prefer_grok and key:
        points = _points_from_grok(frame, key, model)
        if points:
            method_used = f"grok:{model}"

    if points is None:
        console.print("[cyan]Auto-cal: OpenCV ellipse…[/cyan]")
        points = _points_from_opencv(frame)
        method_used = "opencv_ellipse"

    if points is None or len(points) != 4:
        raise RuntimeError(
            "Auto-calibrate failed to find the board. "
            "Improve lighting / full board in frame, or set XAI_API_KEY for Grok assist."
        )

    calib = CamCalib(
        camera_id=camera_id,
        image_points=[[p[0], p[1]] for p in points],
        image_width=w,
        image_height=h,
    )
    ok, reason = _validate_calib(calib, w, h)
    if not ok:
        raise RuntimeError(f"Auto-calibrate produced bad geometry: {reason}")

    overlay = calib.draw_overlay(frame)
    cv2.putText(
        overlay,
        f"AUTO {method_used}  y=save n=discard" if not auto_save else f"AUTO {method_used}",
        (10, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2,
    )

    accept = True
    if show_preview and not auto_save:
        win = f"Auto-cal {camera_id}"
        try:
            cv2.imshow(win, overlay)
            while True:
                k = cv2.waitKey(50) & 0xFF
                if k in (ord("y"), ord("s"), 13):
                    accept = True
                    break
                if k in (ord("n"), ord("q"), 27):
                    accept = False
                    break
            cv2.destroyWindow(win)
        except cv2.error:
            accept = True
    elif show_preview and auto_save:
        try:
            cv2.imshow(f"Auto-cal {camera_id} (saving)", overlay)
            cv2.waitKey(600)
            cv2.destroyAllWindows()
        except cv2.error:
            pass

    if not accept:
        raise SystemExit("Auto-calibrate discarded")

    path = Path(out_path)
    calib.save(path)
    snap = path.with_suffix(".jpg")
    cv2.imwrite(str(snap), overlay)
    console.print(
        f"[bold green]Saved[/bold green] {path}  via {method_used}  preview={snap}"
    )
    return calib
