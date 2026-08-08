"""HTTP client for Autodarts Board Manager (local, default :3180)."""

from __future__ import annotations

import json
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from rich.console import Console
from rich.table import Table

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


def extract_throws(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Best-effort: Board Manager versions vary slightly."""
    for key in ("throws", "Throws", "darts", "Darts"):
        t = state.get(key)
        if isinstance(t, list):
            return t
    # nested
    for nest in ("board", "data", "state"):
        sub = state.get(nest)
        if isinstance(sub, dict):
            for key in ("throws", "Throws", "darts"):
                t = sub.get(key)
                if isinstance(t, list):
                    return t
    return []


def format_dart(dart: dict[str, Any]) -> str:
    seg = dart.get("segment") or dart.get("Segment") or {}
    if isinstance(seg, dict):
        name = seg.get("name") or seg.get("Name") or ""
        num = seg.get("number") if "number" in seg else seg.get("Number")
        mult = seg.get("multiplier") if "multiplier" in seg else seg.get("Multiplier")
        if name:
            return str(name)
        if num is not None and mult is not None:
            if int(mult) == 3:
                return f"T{int(num)}"
            if int(mult) == 2:
                return f"D{int(num)}" if int(num) != 25 else "BULL/50?"
            if int(num) in (25, 50) or str(name).upper().find("BULL") >= 0:
                return str(name or f"BULL{num}")
            return f"S{int(num)}" if int(mult) == 1 else f"{mult}x{num}"
    # flat fields
    for k in ("name", "label", "scoreName", "text"):
        if dart.get(k):
            return str(dart[k])
    return json.dumps(dart, ensure_ascii=False)[:80]


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


def throws_signature(throws: list[dict[str, Any]]) -> str:
    parts = []
    for d in throws:
        parts.append(format_dart(d) + "|" + json.dumps(dart_coords(d) or {}, sort_keys=True))
    return f"{len(throws)}:" + ";".join(parts)
