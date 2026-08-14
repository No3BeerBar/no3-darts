"""HTTP client for Autodarts Board Manager (local, default :3180)."""

from __future__ import annotations

import json
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from rich.console import Console
from rich.table import Table

from .mapping import format_segment_label

console = Console()

# Paths community tools and docs mention / we probe
PROBE_PATHS = (
    "/api/state",
    "/api/config",
    "/api/host",
    "/api/version",
    "/api/cams",
    "/api/cameras",
    "/api/board",
    "/api/status",
    "/api/throws",
    "/api/events",
    "/api/info",
    "/api/reset",
    "/api/calibrate",
    "/api/calibration",
    "/api/board/reset",
    "/api/board/calibrate",
    "/api/detection/start",
    "/api/detection/stop",
    "/api/start",
    "/api/stop",
    "/api/boards",
    "/",
)

# Best-effort Board Manager reset / recalibrate hooks (POST then GET).
# Not all versions expose these - bridge documents manual fallback.
RECAL_PATHS = (
    "/api/reset",
    "/api/board/reset",
    "/api/calibrate",
    "/api/calibration",
    "/api/board/calibrate",
    "/api/cams/reset",
    "/api/cameras/reset",
)

_THROW_KEYS = ("throws", "Throws", "darts", "Darts", "countedDarts", "CountedDarts")
_NEST_KEYS = ("board", "data", "state", "Board", "Data", "State", "game", "Game")
# Autodarts Board Manager /api/state (real fields):
#   status  = Board State (Throw / Throw detected / Takeout / Takeout started /
#             Takeout finished)
#   event   = Detection State (Wait / Stable / Empty / Dart / Hand /
#             Partial Takeout / Takeout)
# Prefer dedicated board-state keys before detection `event`.
_STATUS_KEYS = (
    "status",
    "Status",
    "boardStatus",
    "BoardStatus",
    "board_status",
    "event",
    "Event",
)


class AutodartsClient:
    def __init__(self, host: str = "127.0.0.1", port: int = 3180, timeout: float = 2.0):
        self.base = f"http://{host}:{port}"
        self.timeout = timeout

    def get(self, path: str) -> tuple[int, Any]:
        url = self.base + path
        req = Request(url, method="GET", headers={"Accept": "application/json,*/*"})
        try:
            with urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                code = resp.status
        except HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
            return e.code, raw
        except URLError as e:
            raise ConnectionError(f"Cannot reach Board Manager at {url}: {e}") from e

        try:
            return code, json.loads(raw)
        except json.JSONDecodeError:
            return code, raw

    def state(self) -> dict[str, Any]:
        code, data = self.get("/api/state")
        if code != 200:
            raise RuntimeError(f"/api/state HTTP {code}: {str(data)[:200]}")
        if not isinstance(data, dict):
            raise RuntimeError(f"/api/state not JSON object: {type(data)}")
        return data

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[dict[str, Any]] = None,
        *,
        send_json: bool = True,
    ) -> tuple[int, Any]:
        url = self.base + path
        headers = {"Accept": "application/json,*/*"}
        data = None
        if send_json:
            data = json.dumps(body or {}).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = Request(url, data=data, method=method, headers=headers)
        try:
            with urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                code = resp.status
        except HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
            return e.code, raw
        except URLError as e:
            raise ConnectionError(f"Cannot reach Board Manager at {url}: {e}") from e
        try:
            return code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return code, raw

    def post(self, path: str, body: Optional[dict[str, Any]] = None) -> tuple[int, Any]:
        """POST JSON (or empty body) to Board Manager. Used for reset/calibrate probes."""
        return self._request("POST", path, body, send_json=True)

    def put(self, path: str, body: Optional[dict[str, Any]] = None) -> tuple[int, Any]:
        """PUT to Board Manager. Empty-body PUT is the community start/stop hook."""
        return self._request("PUT", path, body, send_json=body is not None)

    def try_start_detection(self) -> dict[str, Any]:
        """
        Press Autodarts Start on this local Board Manager.

        Community contract (darts-caller): PUT /api/detection/start, then
        PUT /api/start if that 404s. Start only -- never stop or reset.
        """
        tried: list[dict[str, Any]] = []
        for path in ("/api/detection/start", "/api/start"):
            try:
                code, data = self.put(path)
            except ConnectionError as e:
                return {"ok": False, "error": str(e), "tried": tried}
            entry = {
                "path": path,
                "method": "PUT",
                "code": code,
                "preview": str(data)[:120],
            }
            tried.append(entry)
            if 200 <= int(code) < 300:
                return {
                    "ok": True,
                    "path": path,
                    "method": "PUT",
                    "code": code,
                    "detail": data,
                    "tried": tried,
                }
            # Only fall through to /api/start on 404 (or 405 on some builds)
            if int(code) not in (404, 405):
                return {
                    "ok": False,
                    "path": path,
                    "method": "PUT",
                    "code": code,
                    "detail": data,
                    "tried": tried,
                }
        return {"ok": False, "tried": tried}

    def try_recalibrate(self) -> dict[str, Any]:
        """
        Attempt between-games reset/recal via local HTTP only.

        Returns { ok, path, code, detail } for the first accepting endpoint,
        or { ok: False, tried: [...] } when none succeed.
        """
        tried: list[dict[str, Any]] = []
        for path in RECAL_PATHS:
            for method in ("POST", "GET"):
                try:
                    if method == "POST":
                        code, data = self.post(path, {})
                    else:
                        code, data = self.get(path)
                except ConnectionError as e:
                    return {"ok": False, "error": str(e), "tried": tried}
                entry = {
                    "path": path,
                    "method": method,
                    "code": code,
                    "preview": str(data)[:120],
                }
                tried.append(entry)
                if 200 <= code < 300:
                    return {
                        "ok": True,
                        "path": path,
                        "method": method,
                        "code": code,
                        "detail": data,
                        "tried": tried,
                    }
        return {"ok": False, "tried": tried}

    def probe(self) -> None:
        console.print(f"[bold]Probing Autodarts Board Manager[/bold] {self.base}")
        table = Table("path", "HTTP", "type", "keys / preview")
        for path in PROBE_PATHS:
            try:
                code, data = self.get(path)
            except ConnectionError as e:
                console.print(f"[red]{e}[/red]")
                console.print(
                    "Is Autodarts Desktop / Board Manager running?\n"
                    "Open http://127.0.0.1:3180 in a browser."
                )
                return
            if isinstance(data, dict):
                keys = ", ".join(list(data.keys())[:12])
                preview = keys or "{}"
                typ = "object"
            elif isinstance(data, list):
                preview = f"list len={len(data)}"
                typ = "array"
            else:
                preview = str(data)[:80].replace("\n", " ")
                typ = type(data).__name__
            table.add_row(path, str(code), typ, preview)
        console.print(table)
        console.print(
            "\n[dim]Tip: full payloads appear in spy --dump logs. "
            "Look for throws[].segment and any x/y/coords fields.[/dim]"
        )


def _normalize_throw(item: Any) -> Optional[dict[str, Any]]:
    """Coerce a throw entry into a dict with a segment when possible."""
    if item is None:
        return None
    if isinstance(item, str):
        return {"segment": {"name": item}}
    if not isinstance(item, dict):
        return None
    # Already has segment nesting
    if any(k in item for k in ("segment", "Segment", "seg", "Seg")):
        return item
    # Flat {name, number, multiplier}
    if "name" in item or ("number" in item and "multiplier" in item):
        return {"segment": item, **item}
    return item


def extract_throws(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Best-effort: Board Manager versions vary slightly."""
    if not isinstance(state, dict):
        return []

    def from_list(raw: Any) -> list[dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        out: list[dict[str, Any]] = []
        for item in raw:
            norm = _normalize_throw(item)
            if norm is not None:
                out.append(norm)
        return out

    for key in _THROW_KEYS:
        found = from_list(state.get(key))
        if found or (isinstance(state.get(key), list) and len(state.get(key)) == 0):
            # Prefer explicit empty throws[] over digging into nested game state
            if key in state and isinstance(state.get(key), list):
                return found

    # nested
    for nest in _NEST_KEYS:
        sub = state.get(nest)
        if isinstance(sub, dict):
            for key in _THROW_KEYS:
                if key in sub and isinstance(sub.get(key), list):
                    return from_list(sub.get(key))

    # numThrows without throws - nothing to score
    return []


def extract_status(state: dict[str, Any]) -> str:
    """Board status string (Throw / Takeout / ...)."""
    if not isinstance(state, dict):
        return ""
    for key in _STATUS_KEYS:
        val = state.get(key)
        if isinstance(val, str) and val.strip():
            # Prefer dedicated status over event when both exist - caller can
            # pass the full state; we check status/Status first in the tuple.
            if key.lower() in ("status", "boardstatus", "board_status"):
                return val.strip()
    for key in _STATUS_KEYS:
        val = state.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    for nest in _NEST_KEYS:
        sub = state.get(nest)
        if isinstance(sub, dict):
            for key in ("status", "Status", "boardStatus"):
                val = sub.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()
    return ""


def format_dart(dart: dict[str, Any]) -> str:
    """Back-compat wrapper used by spy/compare/viz."""
    return format_segment_label(dart)


def dart_coords(dart: dict[str, Any]) -> Optional[dict[str, float]]:
    """Pull any geometric fields if Board Manager exposes them."""
    out: dict[str, float] = {}
    candidates = [
        ("x", "y"),
        ("X", "Y"),
        ("coordX", "coordY"),
        ("boardX", "boardY"),
        ("u", "v"),
    ]
    for a, b in candidates:
        if a in dart and b in dart:
            try:
                out["x"] = float(dart[a])
                out["y"] = float(dart[b])
            except (TypeError, ValueError):
                pass
    for k in ("r", "radius", "angle", "angleDeg", "phi", "theta"):
        if k in dart:
            try:
                out[k] = float(dart[k])
            except (TypeError, ValueError):
                pass
    # nested coords
    for nest in ("coords", "position", "pos", "location", "point"):
        sub = dart.get(nest)
        if isinstance(sub, dict):
            got = dart_coords(sub)
            if got:
                out.update(got)
    return out or None


def throw_identity(dart: dict[str, Any]) -> str:
    """Stable identity for one dart (label + optional coords)."""
    return format_dart(dart) + "|" + json.dumps(dart_coords(dart) or {}, sort_keys=True)


def throws_signature(throws: list[dict[str, Any]]) -> str:
    parts = [throw_identity(d) for d in throws]
    return f"{len(throws)}:" + ";".join(parts)


def new_throws_since(
    previous: list[dict[str, Any]],
    current: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Return only newly appended throws since `previous`.

    Idempotent for polling: same state -> empty list.
    If the visit list shrinks or diverges (takeout / reset), returns [].
    Caller should treat shrink / correction via `diff_visit` separately.
    """
    if not current:
        return []
    if not previous:
        return list(current)

    prev_ids = [throw_identity(d) for d in previous]
    curr_ids = [throw_identity(d) for d in current]

    # Prefix match -> append-only growth
    if len(curr_ids) >= len(prev_ids) and curr_ids[: len(prev_ids)] == prev_ids:
        return list(current[len(previous) :])

    # Same length, identical -> nothing new
    if curr_ids == prev_ids:
        return []

    # Diverged (correction) or shorter: not "new appends"
    return []


def visit_cleared(
    previous: list[dict[str, Any]],
    current: list[dict[str, Any]],
) -> bool:
    """True when a non-empty visit became empty (typical takeout clear)."""
    return bool(previous) and not current


# Visit diff kinds for bridge correction sync
VISIT_UNCHANGED = "unchanged"
VISIT_APPEND = "append"
VISIT_REPLACE = "replace"  # correction, reorder, or mid-visit shrink
VISIT_CLEARED = "cleared"


def diff_visit(
    previous: list[dict[str, Any]],
    current: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Classify how the Autodarts throw list changed between polls.

    Returns:
      { "kind": unchanged|append|replace|cleared,
        "appended": [...],   # only for append
        "throws": [...] }    # full current list (replace/append)
    """
    prev_ids = [throw_identity(d) for d in previous]
    curr_ids = [throw_identity(d) for d in current]

    if prev_ids == curr_ids:
        return {"kind": VISIT_UNCHANGED, "appended": [], "throws": list(current)}

    if previous and not current:
        return {"kind": VISIT_CLEARED, "appended": [], "throws": []}

    if not previous and current:
        return {
            "kind": VISIT_APPEND,
            "appended": list(current),
            "throws": list(current),
        }

    # Prefix growth -> pure append (idempotent; no double-score)
    if (
        current
        and len(curr_ids) >= len(prev_ids)
        and curr_ids[: len(prev_ids)] == prev_ids
    ):
        return {
            "kind": VISIT_APPEND,
            "appended": list(current[len(previous) :]),
            "throws": list(current),
        }

    # Same length with different identity, shorter list, or non-prefix growth:
    # Board Manager corrected / removed / replaced prior throws.
    return {
        "kind": VISIT_REPLACE,
        "appended": [],
        "throws": list(current),
    }


def extract_camera_health(state: dict[str, Any]) -> dict[str, Any]:
    """
    Best-effort FPS / camera connectivity from Board Manager `/api/state`.

    Field names vary by Autodarts version - we probe common shapes only.
    """
    if not isinstance(state, dict):
        return {
            "ok": False,
            "reason": "invalid_state",
            "fps": [],
            "cameras": [],
            "connected": False,
        }

    cameras: list[dict[str, Any]] = []
    fps_vals: list[float] = []

    def ingest_cam(raw: Any, idx: int) -> None:
        if not isinstance(raw, dict):
            if isinstance(raw, (int, float)):
                fps_vals.append(float(raw))
                cameras.append({"index": idx, "fps": float(raw), "connected": True})
            return
        entry: dict[str, Any] = {"index": idx}
        for fk in ("fps", "FPS", "frameRate", "framerate", "FramesPerSecond"):
            if fk in raw and isinstance(raw[fk], (int, float)):
                entry["fps"] = float(raw[fk])
                fps_vals.append(float(raw[fk]))
                break
        connected = True
        for ck in ("connected", "Connected", "online", "Online", "ok", "OK"):
            if ck in raw:
                connected = bool(raw[ck])
                break
        for sk in ("status", "Status", "state", "State"):
            val = raw.get(sk)
            if isinstance(val, str) and val.strip():
                entry["status"] = val.strip()
                low = val.strip().lower()
                if low in ("disconnected", "offline", "error", "failed", "down"):
                    connected = False
        entry["connected"] = connected
        cameras.append(entry)

    # Top-level camera arrays
    for key in ("cameras", "Cameras", "cams", "Cams", "cam", "Cam"):
        raw = state.get(key)
        if isinstance(raw, list):
            for i, item in enumerate(raw):
                ingest_cam(item, i)
            if cameras:
                break
        if isinstance(raw, dict):
            for i, item in enumerate(raw.values()):
                ingest_cam(item, i)
            if cameras:
                break

    # Nested under board/data/state
    if not cameras:
        for nest in _NEST_KEYS:
            sub = state.get(nest)
            if not isinstance(sub, dict):
                continue
            for key in ("cameras", "Cameras", "cams", "Cams"):
                raw = sub.get(key)
                if isinstance(raw, list):
                    for i, item in enumerate(raw):
                        ingest_cam(item, i)
                if cameras:
                    break
            if cameras:
                break

    # Flat fps array
    if not fps_vals:
        for key in ("fps", "FPS", "camFps", "cameraFps"):
            raw = state.get(key)
            if isinstance(raw, list):
                for i, v in enumerate(raw):
                    if isinstance(v, (int, float)):
                        fps_vals.append(float(v))
                        cameras.append({"index": i, "fps": float(v), "connected": True})
            elif isinstance(raw, (int, float)):
                fps_vals.append(float(raw))

    # Connection flags
    connected = True
    for key in ("connected", "Connected", "boardConnected", "online"):
        if key in state:
            connected = bool(state[key])
            break

    if cameras and any(c.get("connected") is False for c in cameras):
        connected = False

    min_fps = min(fps_vals) if fps_vals else None
    # If we have no FPS telemetry, treat as unknown-but-reachable (state fetched OK)
    ok = connected
    reason = ""
    if not connected:
        reason = "camera_disconnected"
    elif min_fps is not None and min_fps <= 0:
        ok = False
        reason = "fps_zero"
    elif min_fps is not None and min_fps < 1.0:
        ok = False
        reason = "fps_low"

    return {
        "ok": ok,
        "reason": reason,
        "fps": fps_vals,
        "min_fps": min_fps,
        "cameras": cameras,
        "connected": connected,
        "status": extract_status(state),
    }
