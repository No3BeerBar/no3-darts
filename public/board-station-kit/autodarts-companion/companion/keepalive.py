"""
Keep Autodarts detection running while the companion bridge is up.

Board Manager can stay reachable on :3180 after its idle timer (or a leftover
Stop) has stopped the board. Start-Board is one-shot and only launches the
process. This loop is the on-switch: if the companion is quit, it stops.

Start only. Never reset / recalibrate from this path (mid-match takeout bug).
Board1 only: if more than one Autodarts board is visible, start only the
configured board_id.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Optional

from rich.console import Console

from .client import AutodartsClient, extract_status

console = Console()

# Community Board Manager start hooks (PUT). Never reset / calibrate / stop.
START_PATHS = (
    "/api/detection/start",
    "/api/start",
)

STOPPED_TOKENS = frozenset(
    {
        "stopped",
        "stop",
        "idle",
        "not started",
        "notstarted",
    }
)

# Board / detection states that mean the board is already running.
# Do not treat these as idle-timer stop (and do not start again).
RUNNING_TOKENS = frozenset(
    {
        "throw",
        "throw detected",
        "takeout",
        "takeout started",
        "takeout finished",
        "started",
        "wait",
        "stable",
        "empty",
        "dart",
        "hand",
        "partial takeout",
        "removing darts",
    }
)

DETECTING_STATUS = frozenset(
    {
        "throw",
        "throw detected",
        "takeout",
        "takeout started",
        "takeout finished",
        "started",
    }
)

DETECTING_EVENT = frozenset(
    {
        "wait",
        "stable",
        "empty",
        "dart",
        "hand",
        "partial takeout",
        "takeout",
        "removing darts",
    }
)

_ID_KEYS = (
    "boardId",
    "board_id",
    "BoardId",
    "boardID",
    "id",
    "uuid",
    "UUID",
)

_BOOL_RUNNING_KEYS = (
    "running",
    "started",
    "detecting",
    "isRunning",
    "isStarted",
    "isDetecting",
    "detectionRunning",
    "boardRunning",
)


@dataclass
class KeepAliveConfig:
    """Companion-owned keep-alive (independent of camera health restart)."""

    enabled: bool = True
    interval_s: float = 10.0
    start_cooldown_s: float = 30.0
    board_id: str = ""


@dataclass
class KeepAliveTracker:
    config: KeepAliveConfig
    last_check_at: float = 0.0
    last_start_at: float = 0.0
    last_result: dict[str, Any] = field(default_factory=dict)

    def due(self, now: Optional[float] = None) -> bool:
        if not self.config.enabled:
            return False
        t = time.time() if now is None else now
        if self.last_check_at <= 0:
            return True
        return (t - self.last_check_at) >= max(1.0, float(self.config.interval_s))

    def mark_check(self, now: Optional[float] = None) -> None:
        self.last_check_at = time.time() if now is None else now

    def mark_start(self, now: Optional[float] = None) -> None:
        self.last_start_at = time.time() if now is None else now


def _norm_token(val: Any) -> str:
    if not isinstance(val, str):
        return ""
    return val.strip().lower().replace("_", " ")


def _looks_stopped_token(val: Any) -> bool:
    tok = _norm_token(val)
    if not tok:
        return False
    if tok in STOPPED_TOKENS:
        return True
    parts = tok.replace(":", " ").replace("=", " ").split()
    return any(p in STOPPED_TOKENS for p in parts)


def _looks_running_token(val: Any) -> bool:
    tok = _norm_token(val)
    return bool(tok) and tok in RUNNING_TOKENS


def _bool_running_flag(obj: dict[str, Any]) -> Optional[bool]:
    for key in _BOOL_RUNNING_KEYS:
        if key in obj and isinstance(obj[key], bool):
            return bool(obj[key])
    return None


def is_calibrating(state: Optional[dict[str, Any]]) -> bool:
    """True when status/event mentions Calibration -- do not press Start."""
    if not isinstance(state, dict):
        return False
    blobs = [
        extract_status(state),
        state.get("event"),
        state.get("Event"),
        state.get("boardStatus"),
        state.get("BoardStatus"),
    ]
    nested = state.get("board")
    if isinstance(nested, dict):
        blobs.extend(
            [nested.get("status"), nested.get("Status"), nested.get("event")]
        )
    for val in blobs:
        if isinstance(val, str) and "calibrat" in val.strip().lower():
            return True
    return False


def is_board_detecting(state: Optional[dict[str, Any]]) -> bool:
    """
    Ready: GET /api/state is not Stopped.

    Expect status Throw / Throw detected / Takeout* or event
    Wait / Stable / Empty / Dart / Hand / Takeout*. Calibration is not ready.
    """
    if not isinstance(state, dict) or is_calibrating(state):
        return False
    if is_board_stopped(state):
        return False
    status = _norm_token(extract_status(state))
    event = _norm_token(state.get("event") or state.get("Event"))
    if status in DETECTING_STATUS:
        return True
    if event in DETECTING_EVENT:
        return True
    return False


def is_board_stopped(state: Optional[dict[str, Any]]) -> bool:
    """
    True when Board Manager is reachable but detection is stopped.

    Idle-timer stop and leftover Stop typically report status/event "Stopped".
    Takeout / Throw / Started are running -- do not start those.
    Calibration is not Stopped (skip Start; do not fight calib).
    """
    if not isinstance(state, dict):
        return False
    if is_calibrating(state):
        return False

    flag = _bool_running_flag(state)
    if flag is True:
        return False
    if flag is False:
        return True

    nested = state.get("board")
    if isinstance(nested, dict):
        nflag = _bool_running_flag(nested)
        if nflag is True:
            return False
        if nflag is False:
            return True

    status = extract_status(state)
    event = state.get("event") or state.get("Event")
    board_status = state.get("boardStatus") or state.get("BoardStatus")

    # Dedicated board status wins over detection event (Throw + event Stopped
    # still means the board is running).
    if _looks_running_token(status):
        return False
    if _looks_stopped_token(status):
        return True
    for val in (event, board_status):
        if _looks_stopped_token(val):
            return True
        if _looks_running_token(val):
            return False
    if isinstance(nested, dict):
        nest_status = nested.get("status") or nested.get("Status")
        if _looks_running_token(nest_status):
            return False
        if _looks_stopped_token(nest_status):
            return True
        for key in ("event", "Event"):
            if _looks_stopped_token(nested.get(key)):
                return True
            if _looks_running_token(nested.get(key)):
                return False
    return False


def extract_board_id(payload: Any) -> str:
    """Best-effort single board id from a config/state/board object."""
    if isinstance(payload, str):
        return payload.strip()
    if not isinstance(payload, dict):
        return ""
    for key in _ID_KEYS:
        val = payload.get(key)
        if isinstance(val, str) and val.strip() and key != "id":
            return val.strip()
    # Prefer dedicated board id keys; "id" last (host payloads also have id)
    for nest in ("board", "Board", "auth", "Auth", "config", "Config"):
        sub = payload.get(nest)
        if isinstance(sub, dict):
            found = extract_board_id(sub)
            if found:
                return found
        if isinstance(sub, str) and nest.lower() in ("board", "boardid") and sub.strip():
            return sub.strip()
    val = payload.get("id")
    if isinstance(val, str) and val.strip():
        return val.strip()
    return ""


def collect_board_ids(*payloads: Any) -> list[str]:
    """Unique board ids discovered on the local Board Manager."""
    found: list[str] = []

    def add(val: str) -> None:
        v = (val or "").strip()
        if v and v not in found:
            found.append(v)

    def walk(obj: Any, *, allow_generic_id: bool = False) -> None:
        if obj is None:
            return
        if isinstance(obj, str):
            if allow_generic_id:
                add(obj)
            return
        if isinstance(obj, list):
            for item in obj:
                walk(item, allow_generic_id=True)
            return
        if not isinstance(obj, dict):
            return
        for key in ("boardId", "board_id", "BoardId", "boardID"):
            val = obj.get(key)
            if isinstance(val, str) and val.strip():
                add(val)
        for nest in ("boards", "Boards", "items", "Items"):
            raw = obj.get(nest)
            if isinstance(raw, list):
                for item in raw:
                    walk(item, allow_generic_id=True)
        for nest in ("board", "Board", "auth", "Auth"):
            walk(obj.get(nest), allow_generic_id=True)
        if allow_generic_id:
            val = obj.get("id")
            if isinstance(val, str) and val.strip():
                add(val)

    for payload in payloads:
        walk(payload, allow_generic_id=isinstance(payload, list))
    return found


def should_start_this_board(
    configured_id: str,
    *payloads: Any,
) -> bool:
    """
    Board1: one Board Manager per mini-PC (127.0.0.1:3180).

    Fighting a bartender Stop on this local BM is the default.
    Only refuse when a configured board_id is set and the local BM
    reports a different id.
    """
    want = (configured_id or "").strip()
    ids = collect_board_ids(*payloads)
    if want and ids and want not in ids:
        return False
    return True


def start_board_detection(
    client: AutodartsClient,
    board_id: str = "",
) -> dict[str, Any]:
    """
    PUT /api/detection/start, then PUT /api/start on 404. Start only.
    """
    del board_id  # local BM at host:port is this mini-PC's board
    fn = getattr(client, "try_start_detection", None)
    if callable(fn):
        return fn()
    tried: list[dict[str, Any]] = []
    for path in START_PATHS:
        try:
            code, data = client.put(path)
        except ConnectionError as e:
            return {"ok": False, "error": str(e), "tried": tried}
        entry = {"path": path, "method": "PUT", "code": code, "preview": str(data)[:120]}
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
        if int(code) not in (404, 405):
            return {"ok": False, "tried": tried, "code": code}
    return {"ok": False, "tried": tried}


def fetch_board_identity(client: AutodartsClient) -> dict[str, Any]:
    """Best-effort /api/config + /api/boards (404s are fine)."""
    config: Any = None
    boards: Any = None
    try:
        code, data = client.get("/api/config")
        if 200 <= int(code) < 300:
            config = data
    except ConnectionError:
        pass
    for path in ("/api/boards", "/api/board"):
        try:
            code, data = client.get(path)
        except ConnectionError:
            break
        if 200 <= int(code) < 300:
            boards = data
            break
    return {"config": config, "boards": boards}


def maybe_keep_alive(
    client: AutodartsClient,
    tracker: KeepAliveTracker,
    state: Optional[dict[str, Any]],
    *,
    now: Optional[float] = None,
) -> dict[str, Any]:
    """
    If this tick is due and the configured board is stopped, start it.

    Returns a small result dict for tests / logging. Never reset/recal.
    """
    t = time.time() if now is None else now
    if not tracker.due(t):
        return {"ok": True, "action": "skip", "reason": "not_due"}
    tracker.mark_check(t)
    if is_calibrating(state):
        return {"ok": True, "action": "skip", "reason": "calibrating"}
    if not is_board_stopped(state):
        return {"ok": True, "action": "skip", "reason": "already_running"}
    cooldown = max(0.0, float(tracker.config.start_cooldown_s))
    if tracker.last_start_at > 0 and (t - tracker.last_start_at) < cooldown:
        return {"ok": True, "action": "skip", "reason": "start_cooldown"}

    identity = fetch_board_identity(client)
    payloads = (state, identity.get("config"), identity.get("boards"))
    want = tracker.config.board_id
    if not should_start_this_board(want, *payloads):
        console.print(
            "[yellow]keep-alive[/yellow] stopped board is not the configured "
            f"board_id={want!r} - not starting another Autodarts board"
        )
        result = {
            "ok": False,
            "action": "skip",
            "reason": "board_id_mismatch",
            "board_id": want,
        }
        tracker.last_result = result
        return result

    console.print(
        "[bold yellow]keep-alive[/bold yellow] board stopped "
        "(idle timer or leftover Stop) - starting detection"
    )
    start = start_board_detection(client, board_id=want)
    tracker.mark_start(t)
    tracker.last_result = {**start, "action": "start"}
    if start.get("ok"):
        console.print(
            f"[green]keep-alive start OK[/green] "
            f"{start.get('method')} {start.get('path')}"
        )
    else:
        err = start.get("error") or "no start endpoint accepted"
        console.print(f"[red]keep-alive start failed[/red] {err}")
    return tracker.last_result
