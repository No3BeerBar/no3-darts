"""
Board calibration via Grok vision (xAI API) or improved OpenCV auto-detect.

Set XAI_API_KEY (or pass --api-key) for Grok vision.
Falls back to OpenCV circle detection if vision is unavailable.
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
from pathlib import Path
from typing import Any, Optional, Tuple

import cv2
import numpy as np
import requests
from rich.console import Console

from .calibration import (
    BoardCalibration,
    _open_source,
    auto_detect_board_circle,
    build_calibration,
)

console = Console()

# Prefer env override; otherwise try several current image-capable models.
# xAI retires model slugs often → 400 "invalid argument" if wrong.
DEFAULT_VISION_MODEL = os.environ.get("XAI_VISION_MODEL", "grok-4.5")
VISION_MODEL_CANDIDATES = [
    m.strip()
    for m in os.environ.get(
        "XAI_VISION_MODELS",
        # Order: flagship vision, then cheaper chat, then older aliases
        "grok-4.5,grok-4.3,grok-4,grok-2-vision-1212,grok-2-vision-latest",
    ).split(",")
    if m.strip()
]
XAI_RESPONSES_URL = "https://api.x.ai/v1/responses"
XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions"


def grab_frame(source: int | str, warm: int = 8) -> Tuple[np.ndarray, int, int]:
    cap = _open_source(source)
    frame = None
    for _ in range(warm):
        ok, frame = cap.read()
        if not ok:
            break
    cap.release()
    if frame is None:
        raise RuntimeError(f"Could not grab frame from camera {source}")
    h, w = frame.shape[:2]
    return frame, w, h


def frame_to_jpeg_b64(frame_bgr: np.ndarray, max_side: int = 1024) -> str:
    """Encode frame as JPEG base64 (capped size so API payload stays valid)."""
    h, w = frame_bgr.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        frame_bgr = cv2.resize(frame_bgr, (int(w * scale), int(h * scale)))
    ok, buf = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


VISION_PROMPT = """You are calibrating a steel-tip dartboard for automatic scoring.
Cameras are often OBLIQUE (side-on), so the board looks like an ellipse, not a circle.

Return ONLY valid JSON (no markdown) with:

{
  "center_x": <pixel x of bullseye / geometric board center>,
  "center_y": <pixel y of bullseye / geometric board center>,
  "outer_double_x": <pixel x of any point on the OUTER double wire>,
  "outer_double_y": <pixel y of that point>,
  "twenty_x": <pixel x of the center of the printed "20" OR middle of the 20 segment>,
  "twenty_y": <pixel y of that point>,
  "double_at_20_x": <pixel x where OUTER double wire meets the middle of segment 20>,
  "double_at_20_y": <pixel y of that point>,
  "double_at_6_x": <pixel x where OUTER double meets middle of segment 6>,
  "double_at_6_y": <pixel y>,
  "double_at_3_x": <pixel x where OUTER double meets middle of segment 3>,
  "double_at_3_y": <pixel y>,
  "double_at_11_x": <pixel x where OUTER double meets middle of segment 11>,
  "double_at_11_y": <pixel y>,
  "confidence": <0.0 to 1.0>,
  "notes": "<short note about camera angle / occlusion>"
}

Coordinates: image pixels, origin top-left (x right, y down).
If a landmark is unclear, estimate and lower confidence.
"""


def _parse_json_loose(text: str) -> dict[str, Any]:
    text = text.strip()
    # strip markdown fences if present
    if "```" in text:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            text = m.group(1).strip()
    # find first { ... }
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


def _api_error_message(status: int, body: str) -> str:
    """Human-readable API errors. 401 = bad key; 400 = bad request/model."""
    snippet = (body or "")[:600]
    if status == 401:
        return (
            f"xAI API 401 Unauthorized — API key is missing or wrong. "
            f"Check XAI_API_KEY at https://console.x.ai/\n{snippet}"
        )
    if status == 403:
        return (
            f"xAI API 403 Forbidden — key lacks permission for this endpoint/model.\n{snippet}"
        )
    if status == 400:
        return (
            f"xAI API 400 Bad Request — usually wrong model name or image payload, "
            f"not the API key. (Wrong keys are typically 401.)\n{snippet}"
        )
    return f"xAI API {status}: {snippet}"


def _extract_text_from_responses(data: dict[str, Any]) -> str:
    """Parse /v1/responses body → assistant text."""
    if isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return data["output_text"]
    parts: list[str] = []
    for item in data.get("output") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") in (None, "message") or item.get("role") == "assistant":
            content = item.get("content")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") in (
                        "output_text",
                        "text",
                    ):
                        parts.append(str(part.get("text", "")))
                    elif isinstance(part, str):
                        parts.append(part)
    text = "\n".join(p for p in parts if p).strip()
    if text:
        return text
    raise RuntimeError(f"Unexpected xAI responses body: {str(data)[:400]}")


def _extract_text_from_chat(data: dict[str, Any]) -> str:
    """Parse /v1/chat/completions body → assistant text."""
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"Unexpected xAI chat response: {data}") from e
    if isinstance(content, list):
        content = " ".join(
            part.get("text", "") if isinstance(part, dict) else str(part) for part in content
        )
    return str(content)


def _vision_request_variants(model: str, data_url: str) -> list[tuple[str, str, dict]]:
    """
    (label, url, json_body) candidates.
    xAI is picky about model slug + content shape; try several.
    """
    variants: list[tuple[str, str, dict]] = []

    # 1) Documented /v1/responses image understanding (minimal fields)
    variants.append(
        (
            f"responses/{model}",
            XAI_RESPONSES_URL,
            {
                "model": model,
                "store": False,
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_image", "image_url": data_url},
                            {"type": "input_text", "text": VISION_PROMPT},
                        ],
                    }
                ],
            },
        )
    )
    # 2) Same with detail=high
    variants.append(
        (
            f"responses+detail/{model}",
            XAI_RESPONSES_URL,
            {
                "model": model,
                "store": False,
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_image",
                                "image_url": data_url,
                                "detail": "high",
                            },
                            {"type": "input_text", "text": VISION_PROMPT},
                        ],
                    }
                ],
            },
        )
    )
    # 3) Chat completions OpenAI-style (older clients / some keys)
    variants.append(
        (
            f"chat/{model}",
            XAI_CHAT_URL,
            {
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": data_url},
                            },
                            {"type": "text", "text": VISION_PROMPT},
                        ],
                    }
                ],
            },
        )
    )
    # 4) Chat with nested detail
    variants.append(
        (
            f"chat+detail/{model}",
            XAI_CHAT_URL,
            {
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": data_url, "detail": "high"},
                            },
                            {"type": "text", "text": VISION_PROMPT},
                        ],
                    }
                ],
            },
        )
    )
    return variants


def _call_xai_vision(api_key: str, model: str, data_url: str) -> str:
    """
    Ask Grok to locate board landmarks.
    Tries preferred model first, then other candidates, multiple payload shapes.
    """
    key = api_key.strip()
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    models: list[str] = []
    for m in [model, *VISION_MODEL_CANDIDATES]:
        if m and m not in models:
            models.append(m)

    errors: list[str] = []
    for mid in models:
        for label, url, body in _vision_request_variants(mid, data_url):
            console.print(f"[cyan]Grok vision try:[/cyan] {label}")
            try:
                r = requests.post(url, headers=headers, json=body, timeout=120)
            except requests.RequestException as e:
                errors.append(f"{label}: network {e}")
                continue
            if r.status_code < 400:
                console.print(f"[green]Grok vision OK via {label}[/green]")
                data = r.json()
                if "choices" in data:
                    return _extract_text_from_chat(data)
                return _extract_text_from_responses(data)
            snippet = (r.text or "")[:280].replace("\n", " ")
            errors.append(f"{label}: HTTP {r.status_code} {snippet}")
            # Auth errors won't fix with another model shape for same key
            if r.status_code in (401, 403):
                raise RuntimeError(_api_error_message(r.status_code, r.text))
            # 400 invalid model → try next model/variant
            continue

    raise RuntimeError(
        "All Grok vision attempts failed (usually wrong model name for your account "
        "or image payload). Falling back to OpenCV if method allows.\n"
        + "\n".join(f"  - {e}" for e in errors[-12:])
        + "\nTip: set XAI_VISION_MODEL to a model from https://console.x.ai/ "
        "or use --method auto for OpenCV-only calibrate."
    )


def calibrate_with_grok_vision(
    frame_bgr: np.ndarray,
    camera_id: str,
    api_key: str,
    model: str = DEFAULT_VISION_MODEL,
) -> BoardCalibration:
    """Call xAI Grok vision to locate board landmarks."""
    h, w = frame_bgr.shape[:2]
    b64 = frame_to_jpeg_b64(frame_bgr)
    data_url = f"data:image/jpeg;base64,{b64}"

    content = _call_xai_vision(api_key, model, data_url)
    parsed = _parse_json_loose(str(content))
    cx = float(parsed["center_x"])
    cy = float(parsed["center_y"])
    ox = float(parsed["outer_double_x"])
    oy = float(parsed["outer_double_y"])
    tx = float(parsed.get("twenty_x", cx))
    ty = float(parsed.get("twenty_y", cy - 50))
    conf = float(parsed.get("confidence", 0.7))
    notes = str(parsed.get("notes", ""))

    radius = float(math.hypot(ox - cx, oy - cy))
    # rotation: angle of 20 from top, clockwise (image circle approx)
    rotation = float(math.degrees(math.atan2(tx - cx, -(ty - cy))) % 360.0)

    cx = float(np.clip(cx, 0, w - 1))
    cy = float(np.clip(cy, 0, h - 1))
    radius = float(np.clip(radius, min(w, h) * 0.1, min(w, h) * 0.6))

    console.print(
        f"[green]Grok vision landmarks[/green] conf={conf:.2f} center=({cx:.0f},{cy:.0f}) "
        f"R≈{radius:.0f} rot≈{rotation:.1f}°"
    )
    if notes:
        console.print(f"  notes: {notes}")

    # Ellipse + homography for oblique cameras (critical for accuracy)
    calib = build_calibration(
        camera_id,
        frame_bgr,
        cx,
        cy,
        radius,
        rotation,
        force_ellipse=True,
    )

    # If vision gave 4 cardinals on outer double, build true perspective H
    keys = [
        ("double_at_20_x", "double_at_20_y"),
        ("double_at_6_x", "double_at_6_y"),
        ("double_at_3_x", "double_at_3_y"),
        ("double_at_11_x", "double_at_11_y"),
    ]
    pts = []
    for kx, ky in keys:
        if kx in parsed and ky in parsed:
            try:
                pts.append((float(parsed[kx]), float(parsed[ky])))
            except (TypeError, ValueError):
                pass
    if len(pts) == 4:
        from .board_geometry import homography_board_to_image

        H = homography_board_to_image(pts, (0.0, 90.0, 180.0, 270.0))
        if H is not None:
            calib.H_board_to_image = H
            calib.model = "homography"
            # rotation absorbed into H (board angles are absolute)
            calib.rotation_deg = 0.0
            console.print("[green]Perspective homography from 4 outer-double points[/green]")

    console.print(
        f"[green]Calib model={calib.model}[/green]  "
        f"ellipse_a={calib.ellipse_a} ellipse_b={calib.ellipse_b}"
    )
    return calib


def calibrate_auto_opencv(
    frame_bgr: np.ndarray,
    camera_id: str,
    rotation_deg: float = 0.0,
) -> BoardCalibration:
    """
    OpenCV-only auto calibration (circle detection).
    Rotation defaults to 0 (assumes 20 is near the top of the image).
    """
    h, w = frame_bgr.shape[:2]
    detected = auto_detect_board_circle_improved(frame_bgr)
    if detected is None:
        raise RuntimeError(
            "OpenCV could not find a board circle. "
            "Improve lighting / board visibility, or use Grok vision / manual calibrate."
        )
    cx, cy, radius = detected
    console.print(
        f"[green]OpenCV auto[/green] center=({cx:.0f},{cy:.0f}) R={radius:.0f} "
        f"rot={rotation_deg:.1f}° — fitting ellipse for oblique view…"
    )
    return build_calibration(
        camera_id,
        frame_bgr,
        cx,
        cy,
        radius,
        rotation_deg,
        force_ellipse=True,
    )


def auto_detect_board_circle_improved(
    frame_bgr: np.ndarray,
) -> Optional[Tuple[float, float, float]]:
    """Stronger multi-pass Hough + contour circle estimate."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (9, 9), 0)
    h, w = gray.shape
    candidates: list[Tuple[float, float, float, float]] = []  # cx,cy,r,score

    for param2 in (50, 40, 30, 25):
        circles = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=min(h, w) // 3,
            param1=100,
            param2=param2,
            minRadius=min(h, w) // 10,
            maxRadius=min(h, w) // 2,
        )
        if circles is None:
            continue
        for c in circles[0]:
            cx, cy, r = float(c[0]), float(c[1]), float(c[2])
            # prefer larger, more centered circles
            dist_center = math.hypot(cx - w / 2, cy - h / 2)
            score = r - dist_center * 0.15
            candidates.append((cx, cy, r, score))

    # Contour fallback: largest circular-ish contour
    edges = cv2.Canny(gray, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < (min(h, w) ** 2) * 0.02:
            continue
        (cx, cy), r = cv2.minEnclosingCircle(cnt)
        circ = area / (math.pi * r * r + 1e-6)
        if circ < 0.55 or r < min(h, w) / 10:
            continue
        score = float(r) * circ
        candidates.append((float(cx), float(cy), float(r), score))

    if not candidates:
        # last resort: original helper
        return auto_detect_board_circle(frame_bgr)

    cx, cy, r, _ = max(candidates, key=lambda t: t[3])
    return cx, cy, r


def preview_and_confirm(
    frame_bgr: np.ndarray,
    calib: BoardCalibration,
    window: str = "No3 calib preview — y=save n=discard",
) -> bool:
    """Show overlay; return True if user presses y/s."""
    vis = frame_bgr.copy()
    cx, cy, r = int(calib.center_x), int(calib.center_y), int(calib.radius_px)
    cv2.circle(vis, (cx, cy), r, (0, 200, 255), 2)
    cv2.circle(vis, (cx, cy), 5, (0, 255, 0), -1)
    theta = math.radians(calib.rotation_deg)
    ex = int(cx + r * math.sin(theta))
    ey = int(cy - r * math.cos(theta))
    cv2.line(vis, (cx, cy), (ex, ey), (0, 255, 0), 2)
    cv2.putText(vis, "20", (ex + 6, ey), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
    cv2.putText(
        vis,
        "y/s=save  n/q=discard  (or auto-save if no window)",
        (10, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (240, 240, 240),
        1,
    )
    try:
        cv2.imshow(window, vis)
        while True:
            key = cv2.waitKey(50) & 0xFF
            if key in (ord("y"), ord("s"), 13):
                cv2.destroyWindow(window)
                return True
            if key in (ord("n"), ord("q"), 27):
                cv2.destroyWindow(window)
                return False
    except cv2.error:
        # headless — auto accept
        return True


def run_vision_calibrate(
    source: int | str,
    camera_id: str,
    out_path: str | Path,
    api_key: Optional[str] = None,
    model: str = DEFAULT_VISION_MODEL,
    method: str = "vision",  # vision | auto | vision-or-auto
    confirm: bool = True,
) -> BoardCalibration:
    """
    Capture one frame and calibrate.

    method:
      - vision: Grok vision only (needs API key)
      - auto: OpenCV only
      - vision-or-auto: try Grok, fall back to OpenCV
    """
    if isinstance(source, str) and source.isdigit():
        source = int(source)

    frame, _, _ = grab_frame(source)
    key = api_key or os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY") or ""

    calib: Optional[BoardCalibration] = None
    err: Optional[Exception] = None

    if method in ("vision", "vision-or-auto"):
        if not key:
            if method == "vision":
                raise RuntimeError(
                    "No XAI_API_KEY. Set env XAI_API_KEY or pass --api-key. "
                    "Get a key at https://console.x.ai/"
                )
            console.print("[yellow]No XAI_API_KEY — using OpenCV auto[/yellow]")
        else:
            try:
                calib = calibrate_with_grok_vision(frame, camera_id, key, model=model)
            except Exception as e:
                err = e
                console.print(f"[yellow]Grok vision failed: {e}[/yellow]")
                if method == "vision":
                    raise
                console.print("[yellow]Falling back to OpenCV auto…[/yellow]")

    if calib is None and method in ("auto", "vision-or-auto"):
        calib = calibrate_auto_opencv(frame, camera_id)

    if calib is None:
        raise RuntimeError(f"Calibration failed: {err}")

    if confirm:
        ok = preview_and_confirm(frame, calib)
        if not ok:
            raise SystemExit("Calibration discarded")

    path = Path(out_path)
    calib.save(path)
    # also save a debug snapshot next to calib
    snap = path.with_suffix(".jpg")
    vis = frame.copy()
    cv2.circle(
        vis,
        (int(calib.center_x), int(calib.center_y)),
        int(calib.radius_px),
        (0, 200, 255),
        2,
    )
    cv2.imwrite(str(snap), vis)
    console.print(f"[green]Saved[/green] {path}  (preview {snap})")
    return calib
