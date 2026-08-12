"""
Autodarts → No3 score bridge.

Autodarts Board Manager owns throw detection. No3 owns game modes / scoring UI.
This process polls local `/api/state` and POSTs darts into No3.

Also:
- Syncs mid-visit corrections (replace/remove throws) via POST /api/camera/correct
- Watches camera/FPS health, restarts Board Manager when unhealthy, notifies No3
- Optionally triggers between-games recalibrate when the local API supports it
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
    restart_board_manager,
    wait_for_board_manager,
)
from .mapping import dart_to_no3, format_segment_label, is_takeout_status

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


def _dart_payload(dart: dict[str, Any]) -> dict[str, Any]:
    kind, number = dart_to_no3(dart)
    item: dict[str, Any] = {"kind": kind, "number": number, "confidence": 0.99}
    for src, dst in (("angle", "angle"), ("radius", "radius")):
        if isinstance(dart.get(src), (int, float)):
            item[dst] = float(dart[src])
    return item


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
    - New darts appended to `throws` → POST /api/camera/dart (each once).
    - Throws list corrected / shrunk mid-visit → POST /api/camera/correct
      with the full current visit (idempotent replace of open turn).
    - Board status enters Takeout* OR throws list clears after a visit →
      POST /api/camera/end-turn once (covers early pull of 1–2 darts).
    - No3 already auto-ends the turn after the 3rd dart; end-turn then
      returns READY and is harmless.
    """
    client = AutodartsClient(host, port)
    no3_url = (no3_url or os.environ.get("NO3_URL") or "http://localhost:3000").rstrip("/")
    headers = _auth_headers(api_key)
    dart_url = f"{no3_url}/api/camera/dart"
    correct_url = f"{no3_url}/api/camera/correct"
    end_url = f"{no3_url}/api/camera/end-turn"
    health_url = f"{no3_url}/api/camera/health"

    hcfg = health or HealthConfig(enabled=True)
    tracker = HealthTracker(config=hcfg)
    last_health_level = ""
    last_health_post_at = 0.0

    console.print(
        f"[bold]Autodarts → No3 bridge[/bold]\n"
        f"  AD:       http://{host}:{port}/api/state\n"
        f"  No3:      {no3_url}\n"
        f"  room:     {room!r}\n"
        f"  poll:     {poll_ms} ms\n"
        f"  dry_run:  {dry_run}\n"
        f"  end_turn: {end_turn_on_takeout} (on Autodarts takeout / clear)\n"
        f"  health:   {hcfg.enabled} (fps_min={hcfg.fps_min}, "
        f"unhealthy≥{hcfg.unhealthy_seconds}s)\n"
        "\n"
        "Start a No3 match on this room (any game mode). Leave Autodarts detecting.\n"
        "Ctrl+C to stop.\n"
    )

    prev_throws: list[dict[str, Any]] = []
    prev_status = ""
    end_turn_sent = False

    def maybe_end_turn(reason: str) -> None:
        nonlocal end_turn_sent
        if not end_turn_on_takeout or end_turn_sent:
            return
        payload = {"roomId": room}
        console.print(f"[cyan]end-turn[/cyan] ({reason})")
        resp = _post_json(end_url, payload, headers, dry_run)
        if resp is not None:
            end_turn_sent = True
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
            f"[magenta]correct[/magenta] ({reason}) → {labels or '[]'}"
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

    def post_health(payload: dict[str, Any], force: bool = False) -> None:
        nonlocal last_health_level, last_health_post_at
        level = str(payload.get("level") or "")
        now = time.time()
        # Notify on level change, or heartbeat every 20s while unhealthy/degraded
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
            "ts": payload.get("ts") or int(now * 1000),
        }
        resp = _post_json(health_url, body, headers, dry_run)
        if resp is not None:
            last_health_level = level
            last_health_post_at = now
            if level != "ok":
                console.print(
                    f"[yellow]health[/yellow] {level}: {body['message']}"
                )

    def maybe_restart(payload: dict[str, Any]) -> None:
        if not tracker.should_restart():
            return
        console.print("[bold yellow]Cameras unhealthy — restarting Board Manager…[/bold yellow]")
        notify = {**payload, "level": "unhealthy", "restarting": True,
                  "message": "Detection restarting…"}
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
                    "message": "Detection offline — check Board Manager",
                    "restarting": False,
                },
                force=True,
            )

    def maybe_between_games_recal(
        status: str,
        throws: list[Any],
        *,
        visit_just_cleared: bool = False,
    ) -> None:
        if not tracker.should_recal_between_games(
            status,
            throws,
            prev_status,
            visit_just_cleared=visit_just_cleared,
        ):
            return
        console.print("[cyan]between-games[/cyan] attempting Board Manager reset/recal…")
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
                    "ts": int(time.time() * 1000),
                },
                force=True,
            )
        else:
            console.print(
                "[dim]No recalibrate HTTP endpoint accepted — "
                "use Board Manager UI Calibration between games if cams drift.[/dim]"
            )

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
                post_health(hp)
                if not ad_ok or hp.get("level") == "unhealthy":
                    maybe_restart(hp)
                if not ad_ok:
                    time.sleep(max(1.0, poll_ms / 1000.0))
                    continue

            assert state is not None
            throws = extract_throws(state)
            status = extract_status(state)

            if status and status != prev_status:
                console.print(
                    f"[cyan]status[/cyan] {prev_status or '—'} → [bold]{status}[/bold]"
                )
                if is_takeout_status(status) and not is_takeout_status(prev_status):
                    maybe_end_turn(f"status={status}")
                maybe_between_games_recal(status, throws)
                # prev_status updated after visit-clear check so recal can see takeout

            # New visit after empty board — allow end-turn again
            if throws and not prev_throws:
                end_turn_sent = False

            diff = diff_visit(prev_throws, throws)
            kind = diff["kind"]

            if kind == VISIT_CLEARED:
                maybe_between_games_recal(
                    status or prev_status, throws, visit_just_cleared=True
                )

            if status and status != prev_status:
                prev_status = status

            if kind == VISIT_APPEND:
                for dart in diff["appended"]:
                    label = format_segment_label(dart)
                    item = _dart_payload(dart)
                    payload = {**item, "roomId": room}
                    console.print(
                        f"[green]AD[/green] {label} → No3 {item['kind']} {item['number']}"
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

            elif kind == VISIT_REPLACE:
                # If No3 already closed this visit (3rd dart / end-turn), do not
                # apply AD corrections onto the next thrower's open turn.
                if end_turn_sent:
                    console.print(
                        "[dim]AD visit changed after No3 turn ended — "
                        "waiting for takeout/clear[/dim]"
                    )
                else:
                    # Correction / remove / replace prior throws — full visit sync
                    post_correct(diff["throws"], "autodarts_state_diff")
                    if not diff["throws"]:
                        maybe_end_turn("visit emptied via replace")
                        end_turn_sent = False

            elif kind == VISIT_CLEARED:
                console.print("[dim]AD throws cleared[/dim]")
                maybe_end_turn("throws cleared")
                end_turn_sent = False
                # between-games recal already attempted above when kind == CLEARED

            elif kind == VISIT_UNCHANGED:
                pass

            prev_throws = list(throws)
            time.sleep(max(0.05, poll_ms / 1000.0))
    except KeyboardInterrupt:
        console.print("Bridge stopped.")
