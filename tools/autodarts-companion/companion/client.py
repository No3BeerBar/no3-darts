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
    "/",
)

_THROW_KEYS = ("throws", "Throws", "darts", "Darts", "countedDarts", "CountedDarts")
_NEST_KEYS = ("board", "data", "state", "Board", "Data", "State", "game", "Game")
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

    # numThrows without throws — nothing to score
    return []


def extract_status(state: dict[str, Any]) -> str:
    """Board status string (Throw / Takeout / …)."""
    if not isinstance(state, dict):
        return ""
    for key in _STATUS_KEYS:
        val = state.get(key)
        if isinstance(val, str) and val.strip():
            # Prefer dedicated status over event when both exist — caller can
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

    Idempotent for polling: same state → empty list.
    If the visit list shrinks or diverges (takeout / reset), returns [].
    Caller should treat shrink as a visit boundary separately.
    """
    if not current:
        return []
    if not previous:
        return list(current)

    prev_ids = [throw_identity(d) for d in previous]
    curr_ids = [throw_identity(d) for d in current]

    # Prefix match → append-only growth
    if len(curr_ids) >= len(prev_ids) and curr_ids[: len(prev_ids)] == prev_ids:
        return list(current[len(previous) :])

    # Same length, identical → nothing new
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
