"""
Autodarts -> No3 score bridge.

Autodarts Board Manager owns throw detection. No3 owns game modes / scoring UI.
This process polls local `/api/state` and POSTs darts into No3.

Also:
- Syncs mid-visit corrections (replace/remove throws) via POST /api/camera/correct
- Watches camera/FPS health, restarts Board Manager when unhealthy, notifies No3
- Optionally triggers between-games recalibrate when No3 reports a real game boundary
- Freezes dart/correct posts while Autodarts is in takeout / remove-darts OR after
  No3 has already closed the visit (prevents P1 darts attaching to P2)
"""

from __future__ import annotations

import os
import time
from typing import Any, Optional

import requests
from rich.console import Console

from .client import (
    VISIT_APPEND,
    VISIT_CLEARED,
    VISIT_REPLACE,
    VISIT_UNCHANGED,
    AutodartsClient,
    diff_visit,
    extract_status,
    extract_throws,
)
from .health import (
    HealthConfig,
    HealthTracker,
    no3_match_allows_between_games_recal,
    restart_board_manager,
    wait_for_board_manager,
)
from .keepalive import (
    KeepAliveConfig,
    KeepAliveTracker,
    is_calibrating,
    maybe_keep_alive,
)
from .mapping import (
    dart_to_no3,
    format_segment_label,
    is_takeout_finished_status,
    is_takeout_status,
)
from .visit_gate import (
    is_ad_visit_continuation,
    is_takeout_state,
    seat_matches_lock,
    should_clear_stale_takeout,
    should_end_turn_on_clear,
    should_end_turn_on_empty_takeout_finished,
    should_end_turn_leaving_takeout_empty,
    should_end_turn_on_takeout,
    should_unlock_next_visit,
)

console = Console()


def _auth_headers(api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    key = (api_key or os.environ.get("CAMERA_API_KEY") or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
        headers["x-api-key"] = key
    return headers


def _post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    dry_run: bool,
) -> Optional[dict[str, Any]]:
    if dry_run:
        console.print(f"[dim]dry_run POST {url} {payload}[/dim]")
        return {"ok": True, "dry_run": True}
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=5)
    except Exception as e:
        console.print(f"[red]No3 post failed: {e}[/red]")
        return None
    if r.status_code >= 400:
        console.print(f"[red]No3 HTTP {r.status_code}: {r.text[:240]}[/red]")
        # Preserve seat-mismatch (409) so callers can freeze the visit lock
        err_txt = ""
        try:
            err_txt = str((r.json() or {}).get("error") or "")
        except Exception:
            err_txt = r.text[:240]
        if r.status_code == 409 or "seat mismatch" in err_txt.lower():
            return {
                "ok": False,
                "error": err_txt or "seat mismatch",
                "seatMismatch": True,
                "status_code": r.status_code,
            }
        return None
    try:
        return r.json()
    except Exception:
        return {"ok": True, "raw": r.text[:200]}


def _get_json(
    url: str,
    headers: dict[str, str],
    dry_run: bool,
    params: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    if dry_run:
        console.print(f"[dim]dry_run GET {url} {params or {}}[/dim]")
        return {"ok": True, "dry_run": True}
    try:
        r = requests.get(url, headers=headers, params=params or {}, timeout=4)
    except Exception as e:
        console.print(f"[red]No3 get failed: {e}[/red]")
        return None
    if r.status_code >= 400:
        return None
    try:
        data = r.json()
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def build_end_turn_payload(
    room: str, seat: Optional[int]
) -> Optional[dict[str, Any]]:
    """
    Fail-closed end-turn body for No3.

    Never omit expectedPlayerIndex - server rejects blind end-turn while a
    visit is active / for READY ack after auto turnEnded.
    """
    if seat is None:
        return None
    try:
        return {"roomId": room, "expectedPlayerIndex": int(seat)}
    except (TypeError, ValueError):
        return None


def _dart_payload(dart: dict[str, Any]) -> dict[str, Any]:
    kind, number = dart_to_no3(dart)
    item: dict[str, Any] = {"kind": kind, "number": number, "confidence": 0.99}
    for src, dst in (("angle", "angle"), ("radius", "radius")):
        if isinstance(dart.get(src), (int, float)):
            item[dst] = float(dart[src])
    return item


# How long a playing/paused sighting blocks null-match recal (fail closed).
_RECENTLY_PLAYING_S = 60.0


def fetch_no3_match_allows_recal(
    no3_url: str,
    room: str,
    headers: dict[str, str],
    dry_run: bool,
    *,
    recently_playing: bool = False,
) -> bool:
    """
    Ask No3 whether this room is at a real between-games boundary.

    Fail closed (False) on network/parse errors so mid-game recal never runs
    when we cannot confirm match state. Null match after a recent playing
    sighting also fails closed.
    """
    if dry_run:
        return False
    url = f"{no3_url.rstrip('/')}/api/matches/active"
    data = _get_json(url, headers, dry_run=False, params={"room": room})
    if data is None:
        return False
    match = data.get("match")
    if match is not None and not isinstance(match, dict):
        return False
    return no3_match_allows_between_games_recal(
        match if isinstance(match, dict) else None,
        recently_playing=recently_playing,
    )


def run_bridge(
    host: str,
    port: int,
    no3_url: str,
    room: str,
    poll_ms: int = 300,
    api_key: str = "",
    dry_run: bool = False,
    end_turn_on_takeout: bool = True,
    health: Optional[HealthConfig] = None,
    keep_alive: Optional[KeepAliveConfig] = None,
) -> None:
    """
    Poll Autodarts and mirror throws into No3.

    Visit / takeout / correction behaviour
    --------------------------------------
    - New darts appended to `throws` -> POST /api/camera/dart (each once).
    - Throws list corrected / shrunk mid-visit -> POST /api/camera/correct
      with the full current visit (idempotent replace of open turn).
    - Board status enters Takeout* OR throws list clears after a visit ->
      POST /api/camera/end-turn once (covers early pull of 1-2 darts).
    - Poll order (P0): apply APPEND/REPLACE for the current seat *before*
      takeout/end-turn, so a 3-dart AD visit never loses dart 3 to the next seat.
    - Takeout with fewer than 3 throws defers end-turn (wait for dart 3 or CLEARED)
      so a premature Takeout cannot seat-jump dart 3 onto the next player.
    - Incomplete visits never auto end-turn on empty/takeout-finished (dart 3
      lag was seat-jumping every visit). Patron Ready / reset is the only
      incomplete early-pull path.
    - While mirroring an open AD visit, lock the No3 seat and send
      expectedPlayerIndex on dart/correct/end-turn; refuse wrong-seat posts.
    - After No3 closes a visit (3rd dart / end-turn) OR AD status is Takeout*,
      dart/correct posts freeze until throws are empty and AD leaves takeout
      (or patron Ready forces unlock on a clear board).
    - If AD re-shows the closed visit after unlock (late dart 3), refuse to
      post onto the next seat (continuation guard, label-aware).
    - Between-games recal only when No3 match is absent or at a leg/match
      boundary (never while status is playing / paused).
    """
    client = AutodartsClient(host, port)
    no3_url = (no3_url or os.environ.get("NO3_URL") or "http://localhost:3000").rstrip("/")
    headers = _auth_headers(api_key)
    dart_url = f"{no3_url}/api/camera/dart"
    correct_url = f"{no3_url}/api/camera/correct"
    end_url = f"{no3_url}/api/camera/end-turn"
    health_url = f"{no3_url}/api/camera/health"
    takeout_ready_url = f"{no3_url}/api/camera/takeout-ready"
    active_match_url = f"{no3_url}/api/matches/active"

    hcfg = health or HealthConfig(enabled=True)
    tracker = HealthTracker(config=hcfg)
    kacfg = keep_alive or KeepAliveConfig(enabled=True)
    ka_tracker = KeepAliveTracker(config=kacfg)
    last_health_level = ""
    last_health_post_at = 0.0
    last_takeout_post_at = 0.0
    in_takeout = False
    # No3 visit already ended - freeze AD->No3 until clean next thrower
    visit_closed = False
    closed_by_scoring = False
    saw_takeout_after_close = False
    # Patron tapped Ready / Reset takeout on /play
    patron_force_ready = False
    patron_ready_at = 0.0
    # Consecutive empty polls while in_takeout (UI / diagnostics)
    empty_polls_in_takeout = 0
    # Hard seat lock for the open AD visit (No3 currentPlayerIndex)
    locked_seat: Optional[int] = None
    # Throws mirrored/closed for this AD visit - continuation bleed guard
    closed_visit_throws: list[dict[str, Any]] = []
    last_recal_gate_at = 0.0
    recal_gate_allows = False
    last_seen_playing_at = 0.0

    console.print(
        f"[bold]Autodarts -> No3 bridge[/bold]\n"
        f"  AD:       http://{host}:{port}/api/state\n"
        f"  No3:      {no3_url}\n"
        f"  room:     {room!r}\n"
        f"  poll:     {poll_ms} ms\n"
        f"  dry_run:  {dry_run}\n"
        f"  end_turn: {end_turn_on_takeout} (on Autodarts takeout / clear)\n"
        f"  health:   {hcfg.enabled} (fps_min={hcfg.fps_min}, "
        f"unhealthy>={hcfg.unhealthy_seconds}s)\n"
        f"  keep-alive: {kacfg.enabled} (every {kacfg.interval_s}s; "
        f"start stopped board"
        f"{(' id=' + kacfg.board_id) if kacfg.board_id else ''})\n"
        f"  recal:    between_games={hcfg.between_games_recal} "
        f"(gated on No3 match boundary via {active_match_url})\n"
        "\n"
        "Start a No3 match on this room (any game mode). Leave Autodarts detecting.\n"
        "Ctrl+C to stop.\n"
    )

    def ensure_board_detecting(reason: str) -> None:
        """PUT Start on this local BM. Skip calibration. Never reset."""
        if not kacfg.enabled:
            return
        try:
            snap = client.state()
        except Exception:
            snap = None
        if is_calibrating(snap):
            console.print(
                f"[dim]keep-alive[/dim] ({reason}) calibrating - skip Start"
            )
            return
        result = client.try_start_detection()
        ka_tracker.mark_start()
        if result.get("ok"):
            console.print(
                f"[green]keep-alive start OK[/green] ({reason}) "
                f"{result.get('method')} {result.get('path')}"
            )
        else:
            err = result.get("error") or f"HTTP {result.get('code', '?')}"
            console.print(f"[red]keep-alive start failed[/red] ({reason}) {err}")

    # Bridge-up is the on-switch: leftover Stop after boot / Fix Me.
    if kacfg.enabled:
        try:
            boot_state = client.state()
        except Exception:
            boot_state = None
        maybe_keep_alive(client, ka_tracker, boot_state)

    prev_throws: list[dict[str, Any]] = []
    prev_status = ""
    end_turn_sent = False

    def fetch_no3_match() -> Optional[dict[str, Any]]:
        """Best-effort live No3 match for this room (seat + open visit)."""
        if dry_run:
            return None
        data = _get_json(
            active_match_url,
            headers,
            dry_run=False,
            params={"room": room},
        )
        if not data:
            return None
        match = data.get("match")
        return match if isinstance(match, dict) else None

    def fetch_no3_seat() -> Optional[int]:
        """Best-effort No3 currentPlayerIndex for the room (seat lock)."""
        if dry_run:
            return locked_seat if locked_seat is not None else 0
        match = fetch_no3_match()
        if not match:
            return None
        idx = match.get("currentPlayerIndex")
        try:
            return int(idx) if idx is not None else None
        except (TypeError, ValueError):
            return None

    def reopen_visit_if_no3_undid() -> None:
        """
        Tablet Undo / Fix dart can reopen a visit while the bridge still has
        visit_closed. Unfreeze so camera scoring resumes and Reset is not the
        only (missing) control.
        """
        nonlocal visit_closed, end_turn_sent, locked_seat, closed_by_scoring
        if not visit_closed:
            return
        match = fetch_no3_match()
        if not match:
            return
        darts = match.get("currentTurnDarts") or []
        if not isinstance(darts, list) or len(darts) == 0:
            return
        visit_closed = False
        end_turn_sent = False
        closed_by_scoring = False
        idx = match.get("currentPlayerIndex")
        try:
            if idx is not None:
                locked_seat = int(idx)
        except (TypeError, ValueError):
            pass
        console.print(
            "[cyan]visit reopened[/cyan] No3 undo/correct - scoring resumed"
        )

    def ensure_visit_seat_lock() -> Optional[int]:
        """Lock No3 seat for the open AD visit; None if unknown (fail closed)."""
        nonlocal locked_seat
        if locked_seat is not None:
            return locked_seat
        seat = fetch_no3_seat()
        if seat is None:
            console.print(
                "[yellow]seat lock[/yellow] could not read No3 "
                "currentPlayerIndex - refusing score until known"
            )
            return None
        locked_seat = seat
        console.print(
            f"[cyan]seat lock[/cyan] visit locked to No3 player index {seat}"
        )
        return locked_seat

    def mark_visit_closed(
        reason: str,
        *,
        by_scoring: bool = False,
        throws_snapshot: Optional[list[dict[str, Any]]] = None,
    ) -> None:
        nonlocal visit_closed, closed_by_scoring, saw_takeout_after_close
        nonlocal closed_visit_throws
        if by_scoring:
            closed_by_scoring = True
        if throws_snapshot is not None:
            closed_visit_throws = list(throws_snapshot)
        elif prev_throws and not closed_visit_throws:
            closed_visit_throws = list(prev_throws)
        if visit_closed:
            return
        visit_closed = True
        saw_takeout_after_close = False
        console.print(
            f"[bold yellow]visit closed[/bold yellow] ({reason}) - "
            "scoring frozen until board clear / takeout done"
        )

    def maybe_end_turn(reason: str) -> None:
        nonlocal end_turn_sent, locked_seat
        if not end_turn_on_takeout or end_turn_sent:
            # Still freeze even if end-turn already sent / disabled
            if end_turn_sent:
                mark_visit_closed(reason)
            return
        # Hard invariant: never POST end-turn without expectedPlayerIndex.
        # If seat fetch fails, fail closed (no end-turn).
        seat = locked_seat if locked_seat is not None else fetch_no3_seat()
        if seat is None:
            console.print(
                f"[red]end-turn blocked[/red] ({reason}) - "
                "No3 seat unknown (fail closed; no end-turn without "
                "expectedPlayerIndex)"
            )
            mark_visit_closed(f"seat unknown:{reason}")
            return
        if locked_seat is None:
            locked_seat = seat
        live = fetch_no3_seat()
        if live is not None and not seat_matches_lock(
            locked_seat=seat, current_seat=live
        ):
            console.print(
                f"[red]end-turn blocked[/red] ({reason}) - "
                f"No3 seat {live} != visit lock {seat}"
            )
            mark_visit_closed(f"seat mismatch:{reason}")
            return
        payload = build_end_turn_payload(room, seat)
        if payload is None:
            console.print(
                f"[red]end-turn blocked[/red] ({reason}) - "
                "invalid seat for expectedPlayerIndex"
            )
            mark_visit_closed(f"bad seat for end-turn:{reason}")
            return
        console.print(f"[cyan]end-turn[/cyan] ({reason}) seat={seat}")
        resp = _post_json(end_url, payload, headers, dry_run)
        if resp is None:
            return
        if resp.get("seatMismatch") or resp.get("ok") is False:
            console.print(
                f"[red]end-turn refused[/red] ({reason}) - seat mismatch"
            )
            mark_visit_closed(f"end-turn seat mismatch:{reason}")
            return
        end_turn_sent = True
        mark_visit_closed(reason)
        callout = resp.get("callout") if isinstance(resp, dict) else None
        if callout:
            console.print(f"[bold green]END OK[/bold green] {callout}")
        else:
            console.print("[bold green]END OK[/bold green]")

    def post_correct(throws: list[dict[str, Any]], reason: str) -> None:
        nonlocal end_turn_sent
        seat = ensure_visit_seat_lock()
        if seat is None:
            return
        live = fetch_no3_seat()
        if live is not None and not seat_matches_lock(
            locked_seat=seat, current_seat=live
        ):
            console.print(
                f"[red]correct blocked[/red] ({reason}) - "
                f"No3 seat {live} != visit lock {seat}"
            )
            mark_visit_closed("correct seat mismatch")
            return
        darts = [_dart_payload(d) for d in throws]
        labels = [format_segment_label(d) for d in throws]
        payload: dict[str, Any] = {
            "roomId": room,
            "darts": darts,
            "reason": reason,
            "expectedPlayerIndex": seat,
        }
        console.print(
            f"[magenta]correct[/magenta] ({reason}) -> {labels or '[]'}"
        )
        resp = _post_json(correct_url, payload, headers, dry_run)
        if resp is None:
            return
        if resp.get("seatMismatch") or resp.get("ok") is False:
            console.print(
                f"[red]correct refused[/red] ({reason}) - seat mismatch"
            )
            mark_visit_closed(
                "correct seat mismatch",
                throws_snapshot=throws,
            )
            return
        callout = resp.get("callout") if isinstance(resp, dict) else None
        if callout:
            console.print(f"[bold green]CORRECT OK[/bold green] {callout}")
        else:
            console.print("[bold green]CORRECT OK[/bold green]")
        if resp.get("turnEnded"):
            end_turn_sent = True
            mark_visit_closed(
                "correct turnEnded",
                by_scoring=True,
                throws_snapshot=throws,
            )

    def post_health(payload: dict[str, Any], force: bool = False) -> None:
        nonlocal last_health_level, last_health_post_at
        level = str(payload.get("level") or "")
        now = time.time()
        # Notify on level change, or heartbeat every 20s while unhealthy/degraded/takeout
        if (
            not force
            and level == last_health_level
            and (level == "ok" or now - last_health_post_at < 20.0)
        ):
            return
        body = {
            "roomId": room,
            "ok": bool(payload.get("ok")),
            "level": level,
            "message": payload.get("message") or "",
            "reason": payload.get("reason") or "",
            "fps": payload.get("fps") or [],
            "minFps": payload.get("min_fps"),
            "cameras": payload.get("cameras") or [],
            "connected": bool(payload.get("connected")),
            "status": payload.get("status") or "",
            "unhealthyForS": payload.get("unhealthy_for_s") or 0,
            "restarting": bool(payload.get("restarting")),
            "takeout": bool(payload.get("takeout")),
            "ts": payload.get("ts") or int(now * 1000),
        }
        resp = _post_json(health_url, body, headers, dry_run)
        if resp is not None:
            last_health_level = level
            last_health_post_at = now
            if level not in ("ok",):
                console.print(
                    f"[yellow]health[/yellow] {level}: {body['message']}"
                )

    def post_takeout_health(
        status: str,
        *,
        active: bool,
        message: str,
        ad_takeout: bool = False,
        frozen_visit: bool = False,
    ) -> None:
        """
        Post takeout / clear health to No3.

        Never arm takeout:true without a fresh AD takeout read this poll
        (ad_takeout=True) while Board Manager is reachable - unless the
        visit is already frozen (frozen_visit). That silent hold after
        undo/correct left Autodarts yellow and /play with no Reset.
        Clears (active=False) are always allowed so Ready/Reset can unblock.
        """
        nonlocal last_takeout_post_at, patron_force_ready
        if active and not ad_ok:
            return
        if active and not ad_takeout and not frozen_visit:
            return
        # Fresh Ready tap: keep banner cleared briefly while AD reset runs.
        # If AD is still takeout after that, the next poll re-arms Reset.
        if (
            active
            and patron_force_ready
            and patron_ready_at
            and time.time() - patron_ready_at < 2.5
        ):
            return
        if active and patron_force_ready and patron_ready_at:
            if time.time() - patron_ready_at >= 2.5:
                patron_force_ready = False
        now = time.time()
        # Heartbeat takeout banner while active; always post on edge transitions
        if active and now - last_takeout_post_at < 8.0 and last_health_level == "takeout":
            return
        last_takeout_post_at = now
        post_health(
            {
                "ok": True if ad_ok else False,
                "level": "takeout" if active else "ok",
                "message": message,
                "reason": "takeout" if active else "takeout_cleared",
                "fps": [],
                "min_fps": None,
                "cameras": [],
                # Never claim connected while AD is unreachable
                "connected": bool(ad_ok),
                "status": status,
                "unhealthy_for_s": 0,
                "restarting": False,
                "takeout": active,
                "ts": int(now * 1000),
            },
            force=True,
        )

    def maybe_restart(payload: dict[str, Any]) -> None:
        if not tracker.should_restart():
            return
        console.print("[bold yellow]Cameras unhealthy - restarting Board Manager...[/bold yellow]")
        notify = {**payload, "level": "unhealthy", "restarting": True,
                  "message": "Detection restarting..."}
        post_health(notify, force=True)
        restart_board_manager(hcfg)
        tracker.mark_restart()
        ok = wait_for_board_manager(client, timeout_s=45.0)
        if ok:
            console.print("[bold green]Board Manager back online[/bold green]")
            # Relaunch leaves the board Stopped -- press Start, do not reset.
            ensure_board_detecting("after Board Manager restart")
            post_health(
                {
                    "ok": True,
                    "level": "ok",
                    "message": "Cameras healthy",
                    "reason": "recovered",
                    "fps": [],
                    "min_fps": None,
                    "cameras": [],
                    "connected": True,
                    "status": "",
                    "unhealthy_for_s": 0,
                    "restarting": False,
                    "takeout": False,
                    "ts": int(time.time() * 1000),
                },
                force=True,
            )
        else:
            console.print("[red]Board Manager still offline after restart[/red]")
            post_health(
                {
                    **payload,
                    "level": "unhealthy",
                    "message": "Detection offline - check Board Manager",
                    "restarting": False,
                    "takeout": False,
                },
                force=True,
            )

    def refresh_recal_gate(*, force: bool = False) -> bool:
        """
        Cache No3 between-games gate briefly to avoid hammering active match.

        Never trust a cached True - only cache deny. Always re-fetch before a
        real recal attempt (force=True).
        """
        nonlocal last_recal_gate_at, recal_gate_allows, last_seen_playing_at
        if dry_run:
            recal_gate_allows = False
            return False
        now = time.time()
        if (
            not force
            and now - last_recal_gate_at < 2.0
            and not recal_gate_allows
        ):
            return False
        last_recal_gate_at = now
        # Peek match to track recent playing (fail closed on null after mid-match)
        url = f"{no3_url.rstrip('/')}/api/matches/active"
        data = _get_json(url, headers, dry_run=False, params={"room": room})
        match = data.get("match") if isinstance(data, dict) else None
        if isinstance(match, dict):
            st = str(match.get("status") or "").strip().lower()
            if st in ("playing", "paused"):
                last_seen_playing_at = now
        recently = (now - last_seen_playing_at) < _RECENTLY_PLAYING_S
        if data is None:
            recal_gate_allows = False
        else:
            recal_gate_allows = no3_match_allows_between_games_recal(
                match if isinstance(match, dict) else None,
                recently_playing=recently,
            )
        return recal_gate_allows

    def maybe_between_games_recal(
        status: str,
        throws: list[Any],
        *,
        visit_just_cleared: bool = False,
    ) -> None:
        # No3 gate first: never recal while match is playing/paused.
        # Fresh fetch immediately before recal (no stale True cache).
        allows = refresh_recal_gate(force=True)
        if not tracker.should_recal_between_games(
            status,
            throws,
            prev_status,
            visit_just_cleared=visit_just_cleared,
            match_allows_recal=allows,
        ):
            return
        console.print("[cyan]between-games[/cyan] attempting Board Manager reset/recal...")
        result = client.try_recalibrate()
        tracker.mark_recal()
        if result.get("ok"):
            console.print(
                f"[green]recal OK[/green] {result.get('method')} {result.get('path')}"
            )
            post_health(
                {
                    "ok": True,
                    "level": "ok",
                    "message": "Board reset between games",
                    "reason": "between_games_recal",
                    "fps": [],
                    "min_fps": None,
                    "cameras": [],
                    "connected": True,
                    "status": status,
                    "unhealthy_for_s": 0,
                    "restarting": False,
                    "takeout": False,
                    "ts": int(time.time() * 1000),
                },
                force=True,
            )
        else:
            console.print(
                "[dim]No recalibrate HTTP endpoint accepted - "
                "use Board Manager UI Calibration between games if cams drift.[/dim]"
            )

    def unlock_if_ready(
        status: str,
        throws: list[Any],
        *,
        takeout: bool,
        patron_ready: bool = False,
    ) -> bool:
        nonlocal visit_closed, end_turn_sent, in_takeout, prev_throws
        nonlocal closed_by_scoring, saw_takeout_after_close, empty_polls_in_takeout
        nonlocal locked_seat, patron_force_ready, closed_visit_throws
        ready = patron_force_ready
        if not should_unlock_next_visit(
            visit_closed=visit_closed,
            takeout=takeout,
            throws_empty=not throws,
            saw_takeout_after_close=saw_takeout_after_close,
            closed_by_scoring=closed_by_scoring,
            patron_ready=bool(ready or patron_ready),
        ):
            return False
        visit_closed = False
        end_turn_sent = False
        in_takeout = False
        closed_by_scoring = False
        saw_takeout_after_close = False
        patron_force_ready = False
        empty_polls_in_takeout = 0
        locked_seat = None
        prev_throws = []
        # Intentional Ready reset: next seat's first dart is legitimate.
        # Keep closed_visit_throws after auto takeout-unlock so a residual
        # full-visit re-show / late dart-3 prefix is still refused. A single
        # same-segment dart after a completed visit is NOT continuation
        # (41 / Baseball both aim the same target - that freeze is P0).
        if ready:
            closed_visit_throws = []
        console.print(
            "[bold green]next visit ready[/bold green] "
            "board clear - scoring resumed for current thrower"
        )
        post_takeout_health(
            status,
            active=False,
            message="Takeout reset - ready for next visit",
        )
        return True

    def handle_takeout_ready_ack(status: str, throws: list[Any]) -> None:
        """
        Patron Ready/Reset on /play: clear stuck takeout handshake (bridge + UI).

        - Ends open visit (including incomplete early pull - patron confirms).
        - Clears Pull-darts health immediately (no sticky takeout:true).
        - Probes Board Manager /api/reset (stuck takeout) - NOT between-games recal.
        - Unlocks next-visit scoring when throws are empty (even if AD status sticks).
        """
        nonlocal visit_closed, saw_takeout_after_close, in_takeout, patron_force_ready
        nonlocal patron_ready_at
        data = _get_json(
            takeout_ready_url,
            headers,
            dry_run,
            params={"room": room, "consume": "1"},
        )
        if not data or not data.get("pending"):
            return
        console.print(
            "[cyan]takeout-ready[/cyan] patron Ready/Reset - "
            "ending open visit if needed, clearing handshake"
        )
        maybe_end_turn("takeout-ready ack")
        mark_visit_closed("takeout-ready ack")
        # Ack = takeout handshake + force unlock once board is empty
        saw_takeout_after_close = True
        in_takeout = False
        patron_force_ready = True
        patron_ready_at = time.time()
        result = client.try_recalibrate()
        if result.get("ok"):
            console.print(
                f"[green]takeout reset OK[/green] "
                f"{result.get('method')} {result.get('path')}"
            )
        else:
            console.print(
                "[dim]takeout reset: no Board Manager reset endpoint - "
                "UI cleared; unlock when board empty[/dim]"
            )
        # Agree with /play: clear Pull darts banner immediately
        post_takeout_health(
            status,
            active=False,
            message="Ready for next visit",
        )
        if visit_closed and not throws:
            unlock_if_ready(
                status,
                throws,
                takeout=False,
                patron_ready=True,
            )

    def post_appended_darts(
        appended: list[dict[str, Any]],
        status: str,
        *,
        full_throws: list[dict[str, Any]],
    ) -> None:
        """Post new AD throws to the locked No3 seat; stop if visit ends."""
        nonlocal end_turn_sent
        seat = ensure_visit_seat_lock()
        if seat is None:
            return
        for dart in appended:
            if visit_closed:
                console.print(
                    "[dim]AD visit frozen mid-append - "
                    "stopping further dart posts[/dim]"
                )
                break
            live = fetch_no3_seat()
            if live is not None and not seat_matches_lock(
                locked_seat=seat, current_seat=live
            ):
                console.print(
                    f"[red]dart blocked[/red] No3 seat {live} != "
                    f"visit lock {seat} - refusing wrong-seat score"
                )
                mark_visit_closed(
                    "dart seat mismatch",
                    throws_snapshot=full_throws,
                )
                break
            label = format_segment_label(dart)
            item = _dart_payload(dart)
            payload = {
                **item,
                "roomId": room,
                "expectedPlayerIndex": seat,
            }
            console.print(
                f"[green]AD[/green] {label} -> No3 "
                f"{item['kind']} {item['number']} (seat {seat})"
            )
            resp = _post_json(dart_url, payload, headers, dry_run)
            if resp is None:
                # Transient network / 5xx - retry next poll; do not advance seat
                break
            if resp.get("seatMismatch") or resp.get("ok") is False:
                console.print(
                    "[red]dart refused[/red] seat mismatch - "
                    "freeze visit (will not post onto next player)"
                )
                mark_visit_closed(
                    "dart seat mismatch",
                    throws_snapshot=full_throws,
                )
                break
            callout = resp.get("callout") if isinstance(resp, dict) else None
            if callout:
                console.print(f"[bold green]POST OK[/bold green] {callout}")
            else:
                console.print("[bold green]POST OK[/bold green]")
            if resp.get("turnEnded"):
                end_turn_sent = True
                mark_visit_closed(
                    "dart turnEnded",
                    by_scoring=True,
                    throws_snapshot=full_throws,
                )
                # Only arm banner when this AD poll shows takeout
                if is_takeout_status(status or ""):
                    post_takeout_health(
                        status,
                        active=True,
                        message="Pull darts - takeout",
                        ad_takeout=True,
                    )
                break

    try:
        while True:
            ad_ok = True
            state: Optional[dict[str, Any]] = None
            try:
                state = client.state()
            except Exception as e:
                ad_ok = False
                console.print(f"[red]AD offline: {e}[/red]")

            takeout_now = bool(state) and is_takeout_state(state)
            status_early = extract_status(state) if state else ""

            if hcfg.enabled:
                hp = tracker.evaluate(state, ad_ok)
                if not ad_ok:
                    # AD unreachable: ALWAYS clear sticky takeout on No3.
                    # Do not let banner_on block offline health. Still consume
                    # patron Reset/Ready ack so /play is never wedged offline.
                    in_takeout = False
                    post_health(
                        {**hp, "takeout": False, "connected": False},
                        force=True,
                    )
                    maybe_restart(hp)
                    handle_takeout_ready_ack(prev_status or "", [])
                    time.sleep(max(1.0, poll_ms / 1000.0))
                    continue
                # AD takeout this poll always wins. Never clobber with
                # "Cameras healthy" / takeout:false (undo desync / silent hold).
                banner_on = takeout_now or in_takeout or visit_closed
                if takeout_now:
                    post_takeout_health(
                        status_early,
                        active=True,
                        message="Pull darts - takeout",
                        ad_takeout=True,
                    )
                elif not banner_on:
                    post_health({**hp, "takeout": False})
                if hp.get("level") == "unhealthy":
                    maybe_restart(hp)

            assert state is not None
            throws = extract_throws(state)
            status = extract_status(state)
            takeout_now = is_takeout_state(state)
            # Tablet Undo / Fix dart may have reopened the No3 visit
            reopen_visit_if_no3_undid()
            # After undo, if AD is still yellow / takeout, keep the banner.
            # Do not treat a reopened visit as "play is live, hide Reset".
            if takeout_now:
                in_takeout = True
                post_takeout_health(
                    status,
                    active=True,
                    message="Pull darts - takeout",
                    ad_takeout=True,
                )
            # Idle-timer / leftover Stop: start this board only. Never reset.
            if kacfg.enabled:
                maybe_keep_alive(client, ka_tracker, state)

            if in_takeout and not throws:
                empty_polls_in_takeout += 1
            else:
                empty_polls_in_takeout = 0

            # Patron "Reset takeout / Ready for next visit" from /play
            handle_takeout_ready_ack(status or prev_status, throws)

            if status and status != prev_status:
                console.print(
                    f"[cyan]status[/cyan] {prev_status or '-'} -> [bold]{status}[/bold]"
                )
                maybe_between_games_recal(status, throws)

            diff = diff_visit(prev_throws, throws)
            kind = diff["kind"]

            if kind == VISIT_CLEARED:
                maybe_between_games_recal(
                    status or prev_status, throws, visit_just_cleared=True
                )

            if status and status != prev_status:
                prev_status = status

            # P0: sync AD throw growth onto the *current* seat before end-turn.
            # Takeout alone must NOT block this poll - fixture state_three_darts
            # is Takeout + 3 throws together. Only a prior visit_closed freezes.
            # (After sync, takeout handling below closes/freezes the visit.)
            # Mid-visit AD clear flicker: keep prev_throws so dart 1/2 are not
            # re-posted when the list reappears with dart 3.
            retain_prev_throws = False

            # After premature end-turn + unlock, AD may re-show the same visit
            # with late dart 3. Never post that onto the next seat.
            if (
                not visit_closed
                and throws
                and closed_visit_throws
                and is_ad_visit_continuation(closed_visit_throws, throws)
            ):
                console.print(
                    "[bold red]visit continuation[/bold red] AD re-showed "
                    "a closed visit (late dart 3?) - refusing wrong-seat post"
                )
                mark_visit_closed(
                    "ad visit continuation after unlock",
                    throws_snapshot=list(throws),
                )
                saw_takeout_after_close = True
                if takeout_now:
                    post_takeout_health(
                        status,
                        active=True,
                        message="Pull darts - takeout",
                        ad_takeout=True,
                    )

            if kind == VISIT_APPEND:
                if visit_closed:
                    labels = [format_segment_label(d) for d in diff["appended"]]
                    console.print(
                        f"[dim]AD visit closed - ignoring "
                        f"{labels or 'dart(s)'}[/dim]"
                    )
                else:
                    # Fresh visit (not a re-show of the one we closed)
                    closed_visit_throws = []
                    post_appended_darts(
                        diff["appended"],
                        status,
                        full_throws=list(throws),
                    )

            elif kind == VISIT_REPLACE:
                if visit_closed:
                    console.print(
                        "[dim]AD visit closed - ignoring visit replace[/dim]"
                    )
                else:
                    closed_visit_throws = []
                    post_correct(diff["throws"], "autodarts_state_diff")
                    if not diff["throws"]:
                        maybe_end_turn("visit emptied via replace")

            elif kind == VISIT_CLEARED:
                console.print("[dim]AD throws cleared[/dim]")
                if should_end_turn_on_clear(
                    takeout=takeout_now,
                    in_takeout=in_takeout,
                    visit_closed=visit_closed,
                    prev_throw_count=len(prev_throws),
                    takeout_finished=is_takeout_finished_status(status),
                ):
                    maybe_end_turn("throws cleared")
                else:
                    console.print(
                        "[dim]AD clear while still throwing - "
                        "no end-turn (wait for dart 3 / sustained empty)[/dim]"
                    )
                    retain_prev_throws = True

            elif kind == VISIT_UNCHANGED:
                pass

            # Early pull: sustained empty + takeout finished (not one-poll flicker)
            if should_end_turn_on_empty_takeout_finished(
                visit_closed=visit_closed,
                throws_empty=not throws,
                in_takeout=in_takeout,
                status=status or "",
                empty_polls=empty_polls_in_takeout,
            ):
                maybe_end_turn("takeout finished empty")

            # Takeout / freeze AFTER visit sync so all 3 AD throws map to one seat.
            # Incomplete visit (1-2 throws): latch in_takeout but defer end-turn
            # until dart 3 is mirrored or CLEARED confirms an early pull.
            # Patron Ready from /play must keep the Pull-darts banner clearable:
            # do not re-arm takeout health while patron_force_ready is latched
            # (AD status often sticks on "Removing darts" after Ready).
            if takeout_now and not in_takeout:
                if patron_force_ready:
                    console.print(
                        "[dim]takeout sticky after Ready - "
                        "keeping banner cleared until unlock[/dim]"
                    )
                    if visit_closed:
                        saw_takeout_after_close = True
                else:
                    in_takeout = True
                    if visit_closed:
                        saw_takeout_after_close = True
                        console.print(
                            "[bold yellow]takeout[/bold yellow] "
                            "AD remove-darts - scoring frozen"
                        )
                        post_takeout_health(
                            status,
                            active=True,
                            message="Pull darts - takeout",
                            ad_takeout=True,
                        )
                    elif should_end_turn_on_takeout(
                        visit_closed=visit_closed,
                        throws_count=len(throws),
                    ):
                        console.print(
                            "[bold yellow]takeout[/bold yellow] "
                            "AD remove-darts - scoring frozen"
                        )
                        maybe_end_turn(f"status={status}")
                        mark_visit_closed(f"takeout:{status}")
                        if visit_closed:
                            saw_takeout_after_close = True
                        post_takeout_health(
                            status,
                            active=True,
                            message="Pull darts - takeout",
                            ad_takeout=True,
                        )
                    else:
                        console.print(
                            "[bold yellow]takeout[/bold yellow] "
                            f"incomplete visit ({len(throws)}/3) - "
                            "defer end-turn until dart 3 or clear"
                        )
                        post_takeout_health(
                            status,
                            active=True,
                            message="Pull darts - takeout",
                            ad_takeout=True,
                        )
            elif takeout_now and in_takeout:
                if patron_force_ready:
                    # Ready already cleared UI; do not re-stick banner
                    if visit_closed:
                        saw_takeout_after_close = True
                else:
                    if visit_closed:
                        saw_takeout_after_close = True
                    elif should_end_turn_on_takeout(
                        visit_closed=visit_closed,
                        throws_count=len(throws),
                    ):
                        # Deferred: dart 3 arrived while still in takeout
                        console.print(
                            "[bold yellow]takeout[/bold yellow] "
                            "full visit mirrored - end-turn now"
                        )
                        maybe_end_turn(f"status={status}")
                        mark_visit_closed(f"takeout:{status}")
                        if visit_closed:
                            saw_takeout_after_close = True
                    post_takeout_health(
                        status,
                        active=True,
                        message="Pull darts - takeout",
                        ad_takeout=True,
                    )
            elif should_end_turn_leaving_takeout_empty(
                visit_closed=visit_closed,
                throws_empty=not throws,
                in_takeout=in_takeout,
                takeout=takeout_now,
                empty_polls=empty_polls_in_takeout,
            ):
                # Disabled for incomplete visits (always False) - kept for gate API
                maybe_end_turn("left takeout empty")
                mark_visit_closed("left takeout empty")
                if visit_closed:
                    saw_takeout_after_close = True
                in_takeout = False
                empty_polls_in_takeout = 0
            elif should_clear_stale_takeout(
                takeout=takeout_now,
                in_takeout=in_takeout,
                visit_closed=visit_closed,
                throws_empty=not throws,
            ):
                # Left takeout but throws still present - false alarm, keep scoring
                in_takeout = False
                empty_polls_in_takeout = 0
                console.print(
                    "[dim]takeout cleared mid-visit - "
                    "continue scoring current seat[/dim]"
                )
                # Clear sticky Pull-darts banner (was missing - left UI stuck)
                if not visit_closed:
                    post_takeout_health(
                        status,
                        active=False,
                        message="Ready for next visit",
                    )
            elif visit_closed and not takeout_now:
                # Frozen after correct/end-turn while AD is in yellow reset
                # (or Throw with leftover darts). Must still arm /play Reset -
                # silent hold was the Board 1 deadlock.
                post_takeout_health(
                    status or prev_status,
                    active=True,
                    message="Pull darts - takeout",
                    ad_takeout=False,
                    frozen_visit=True,
                )

            unlock_if_ready(status, throws, takeout=takeout_now)

            # Track AD throws even while frozen so CLEARED still detects pull-out
            if not retain_prev_throws:
                prev_throws = list(throws)
            time.sleep(max(0.05, poll_ms / 1000.0))
    except KeyboardInterrupt:
        console.print("Bridge stopped.")
