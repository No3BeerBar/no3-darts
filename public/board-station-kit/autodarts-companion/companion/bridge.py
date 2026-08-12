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
from .mapping import dart_to_no3, format_segment_label
from .visit_gate import (
    is_takeout_state,
    scoring_frozen,
    should_end_turn_on_clear,
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


def _dart_payload(dart: dict[str, Any]) -> dict[str, Any]:
    kind, number = dart_to_no3(dart)
    item: dict[str, Any] = {"kind": kind, "number": number, "confidence": 0.99}
    for src, dst in (("angle", "angle"), ("radius", "radius")):
        if isinstance(dart.get(src), (int, float)):
            item[dst] = float(dart[src])
    return item


def fetch_no3_match_allows_recal(
    no3_url: str,
    room: str,
    headers: dict[str, str],
    dry_run: bool,
) -> bool:
    """
    Ask No3 whether this room is at a real between-games boundary.

    Fail closed (False) on network/parse errors so mid-game recal never runs
    when we cannot confirm match state.
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
        match if isinstance(match, dict) else None
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
    - After No3 closes a visit (3rd dart / end-turn) OR AD status is Takeout*,
      dart/correct posts freeze until throws are empty and AD leaves takeout.
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
    last_health_level = ""
    last_health_post_at = 0.0
    last_takeout_post_at = 0.0
    in_takeout = False
    # No3 visit already ended - freeze AD->No3 until clean next thrower
    visit_closed = False
    closed_by_scoring = False
    saw_takeout_after_close = False
    last_recal_gate_at = 0.0
    recal_gate_allows = False

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
        f"  recal:    between_games={hcfg.between_games_recal} "
        f"(gated on No3 match boundary via {active_match_url})\n"
        "\n"
        "Start a No3 match on this room (any game mode). Leave Autodarts detecting.\n"
        "Ctrl+C to stop.\n"
    )

    prev_throws: list[dict[str, Any]] = []
    prev_status = ""
    end_turn_sent = False

    def mark_visit_closed(reason: str, *, by_scoring: bool = False) -> None:
        nonlocal visit_closed, closed_by_scoring, saw_takeout_after_close
        if by_scoring:
            closed_by_scoring = True
        if visit_closed:
            return
        visit_closed = True
        saw_takeout_after_close = False
        console.print(
            f"[bold yellow]visit closed[/bold yellow] ({reason}) - "
            "scoring frozen until board clear / takeout done"
        )

    def maybe_end_turn(reason: str) -> None:
        nonlocal end_turn_sent
        if not end_turn_on_takeout or end_turn_sent:
            # Still freeze even if end-turn already sent / disabled
            if end_turn_sent:
                mark_visit_closed(reason)
            return
        payload = {"roomId": room}
        console.print(f"[cyan]end-turn[/cyan] ({reason})")
        resp = _post_json(end_url, payload, headers, dry_run)
        if resp is not None:
            end_turn_sent = True
            mark_visit_closed(reason)
            callout = resp.get("callout") if isinstance(resp, dict) else None
            if callout:
                console.print(f"[bold green]END OK[/bold green] {callout}")
            else:
                console.print("[bold green]END OK[/bold green]")

    def post_correct(throws: list[dict[str, Any]], reason: str) -> None:
        nonlocal end_turn_sent
        darts = [_dart_payload(d) for d in throws]
        labels = [format_segment_label(d) for d in throws]
        payload: dict[str, Any] = {
            "roomId": room,
            "darts": darts,
            "reason": reason,
        }
        console.print(
            f"[magenta]correct[/magenta] ({reason}) -> {labels or '[]'}"
        )
        resp = _post_json(correct_url, payload, headers, dry_run)
        if resp is not None:
            callout = resp.get("callout") if isinstance(resp, dict) else None
            if callout:
                console.print(f"[bold green]CORRECT OK[/bold green] {callout}")
            else:
                console.print("[bold green]CORRECT OK[/bold green]")
            if resp.get("turnEnded"):
                end_turn_sent = True
                mark_visit_closed("correct turnEnded", by_scoring=True)

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

    def post_takeout_health(status: str, *, active: bool, message: str) -> None:
        nonlocal last_takeout_post_at
        now = time.time()
        # Heartbeat takeout banner while active; always post on edge transitions
        if active and now - last_takeout_post_at < 8.0 and last_health_level == "takeout":
            return
        last_takeout_post_at = now
        post_health(
            {
                "ok": True,
                "level": "takeout" if active else "ok",
                "message": message,
                "reason": "takeout" if active else "takeout_cleared",
                "fps": [],
                "min_fps": None,
                "cameras": [],
                "connected": True,
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

    def refresh_recal_gate() -> bool:
        """Cache No3 between-games gate briefly to avoid hammering active match."""
        nonlocal last_recal_gate_at, recal_gate_allows
        now = time.time()
        if now - last_recal_gate_at < 2.0:
            return recal_gate_allows
        last_recal_gate_at = now
        recal_gate_allows = fetch_no3_match_allows_recal(
            no3_url, room, headers, dry_run
        )
        return recal_gate_allows

    def maybe_between_games_recal(
        status: str,
        throws: list[Any],
        *,
        visit_just_cleared: bool = False,
    ) -> None:
        # No3 gate first: never recal while match is playing/paused.
        # (Cached briefly; only consulted on status change / visit clear.)
        allows = refresh_recal_gate()
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

    def unlock_if_ready(status: str, throws: list[Any], *, takeout: bool) -> bool:
        nonlocal visit_closed, end_turn_sent, in_takeout, prev_throws
        nonlocal closed_by_scoring, saw_takeout_after_close
        if not should_unlock_next_visit(
            visit_closed=visit_closed,
            takeout=takeout,
            throws_empty=not throws,
            saw_takeout_after_close=saw_takeout_after_close,
            closed_by_scoring=closed_by_scoring,
        ):
            return False
        visit_closed = False
        end_turn_sent = False
        in_takeout = False
        closed_by_scoring = False
        saw_takeout_after_close = False
        prev_throws = []
        console.print(
            "[bold green]next visit ready[/bold green] "
            "board clear - scoring resumed for current thrower"
        )
        post_takeout_health(
            status,
            active=False,
            message="Ready for next visit",
        )
        return True

    def handle_takeout_ready_ack(status: str) -> None:
        """Patron Ready: probe AD reset; do NOT unlock while throws remain."""
        nonlocal visit_closed, saw_takeout_after_close
        data = _get_json(
            takeout_ready_url,
            headers,
            dry_run,
            params={"room": room, "consume": "1"},
        )
        if not data or not data.get("pending"):
            return
        console.print(
            "[cyan]takeout-ready[/cyan] patron acknowledged - "
            "probing board reset (scoring stays frozen until AD clear)"
        )
        maybe_end_turn("takeout-ready ack")
        mark_visit_closed("takeout-ready ack")
        # Ack counts as takeout handshake so empty board can unlock
        saw_takeout_after_close = True
        result = client.try_recalibrate()
        if result.get("ok"):
            console.print(
                f"[green]takeout reset OK[/green] "
                f"{result.get('method')} {result.get('path')}"
            )
        else:
            console.print(
                "[dim]takeout reset: no Board Manager reset endpoint - "
                "wait for empty board / takeout clear[/dim]"
            )
        post_takeout_health(
            status,
            active=True,
            message="Pull darts - takeout",
        )

    def post_appended_darts(
        appended: list[dict[str, Any]], status: str
    ) -> None:
        """Post new AD throws to the current No3 seat; stop if visit ends."""
        nonlocal end_turn_sent
        for dart in appended:
            if visit_closed:
                console.print(
                    "[dim]AD visit frozen mid-append - "
                    "stopping further dart posts[/dim]"
                )
                break
            label = format_segment_label(dart)
            item = _dart_payload(dart)
            payload = {**item, "roomId": room}
            console.print(
                f"[green]AD[/green] {label} -> No3 "
                f"{item['kind']} {item['number']}"
            )
            resp = _post_json(dart_url, payload, headers, dry_run)
            if resp is not None:
                callout = resp.get("callout") if isinstance(resp, dict) else None
                if callout:
                    console.print(f"[bold green]POST OK[/bold green] {callout}")
                else:
                    console.print("[bold green]POST OK[/bold green]")
                if resp.get("turnEnded"):
                    end_turn_sent = True
                    mark_visit_closed("dart turnEnded", by_scoring=True)
                    post_takeout_health(
                        status,
                        active=True,
                        message="Pull darts - takeout",
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

            if hcfg.enabled:
                hp = tracker.evaluate(state, ad_ok)
                banner_on = in_takeout or visit_closed
                # Do not overwrite an active takeout / visit-closed banner
                if not (banner_on and hp.get("ok") and not hp.get("restarting")):
                    if not banner_on:
                        post_health({**hp, "takeout": False})
                if not ad_ok or hp.get("level") == "unhealthy":
                    maybe_restart(hp)
                if not ad_ok:
                    time.sleep(max(1.0, poll_ms / 1000.0))
                    continue

            assert state is not None
            throws = extract_throws(state)
            status = extract_status(state)
            takeout_now = is_takeout_state(state)

            # Patron "Ready for next visit" from /play
            handle_takeout_ready_ack(status or prev_status)

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

            if kind == VISIT_APPEND:
                if visit_closed:
                    labels = [format_segment_label(d) for d in diff["appended"]]
                    console.print(
                        f"[dim]AD visit closed - ignoring "
                        f"{labels or 'dart(s)'}[/dim]"
                    )
                else:
                    post_appended_darts(diff["appended"], status)

            elif kind == VISIT_REPLACE:
                if visit_closed:
                    console.print(
                        "[dim]AD visit closed - ignoring visit replace[/dim]"
                    )
                else:
                    post_correct(diff["throws"], "autodarts_state_diff")
                    if not diff["throws"]:
                        maybe_end_turn("visit emptied via replace")

            elif kind == VISIT_CLEARED:
                console.print("[dim]AD throws cleared[/dim]")
                if should_end_turn_on_clear(
                    takeout=takeout_now,
                    in_takeout=in_takeout,
                    visit_closed=visit_closed,
                ):
                    maybe_end_turn("throws cleared")
                else:
                    console.print(
                        "[dim]AD clear while still throwing - "
                        "no end-turn (wait for dart 3 / takeout)[/dim]"
                    )
                    retain_prev_throws = True

            elif kind == VISIT_UNCHANGED:
                pass

            # Takeout / freeze AFTER visit sync so all 3 AD throws map to one seat
            if takeout_now and not in_takeout:
                in_takeout = True
                if visit_closed:
                    saw_takeout_after_close = True
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
                )
            elif takeout_now and in_takeout:
                if visit_closed:
                    saw_takeout_after_close = True
                post_takeout_health(
                    status,
                    active=True,
                    message="Pull darts - takeout",
                )
            elif visit_closed and not takeout_now:
                post_takeout_health(
                    status,
                    active=True,
                    message="Pull darts - takeout",
                )

            unlock_if_ready(status, throws, takeout=takeout_now)

            # Track AD throws even while frozen so CLEARED still detects pull-out
            if not retain_prev_throws:
                prev_throws = list(throws)
            time.sleep(max(0.05, poll_ms / 1000.0))
    except KeyboardInterrupt:
        console.print("Bridge stopped.")
