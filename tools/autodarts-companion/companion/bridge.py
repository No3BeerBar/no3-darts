"""
Autodarts → No3 score bridge.

Autodarts Board Manager owns throw detection. No3 owns game modes / scoring UI.
This process polls local `/api/state` and POSTs darts into No3.
"""

from __future__ import annotations

import os
import time
from typing import Any, Optional

import requests
from rich.console import Console

from .client import (
    AutodartsClient,
    extract_status,
    extract_throws,
    new_throws_since,
    visit_cleared,
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


def run_bridge(
    host: str,
    port: int,
    no3_url: str,
    room: str,
    poll_ms: int = 300,
    api_key: str = "",
    dry_run: bool = False,
    end_turn_on_takeout: bool = True,
) -> None:
    """
    Poll Autodarts and mirror throws into No3.

    Visit / takeout behaviour
    -------------------------
    - New darts appended to `throws` → POST /api/camera/dart (each once).
    - Board status enters Takeout* OR throws list clears after a visit →
      POST /api/camera/end-turn once (covers early pull of 1–2 darts).
    - No3 already auto-ends the turn after the 3rd dart; end-turn then
      returns READY and is harmless.
    """
    client = AutodartsClient(host, port)
    no3_url = (no3_url or os.environ.get("NO3_URL") or "http://localhost:3000").rstrip("/")
    headers = _auth_headers(api_key)
    dart_url = f"{no3_url}/api/camera/dart"
    end_url = f"{no3_url}/api/camera/end-turn"

    console.print(
        f"[bold]Autodarts → No3 bridge[/bold]\n"
        f"  AD:       http://{host}:{port}/api/state\n"
        f"  No3:      {no3_url}\n"
        f"  room:     {room!r}\n"
        f"  poll:     {poll_ms} ms\n"
        f"  dry_run:  {dry_run}\n"
        f"  end_turn: {end_turn_on_takeout} (on Autodarts takeout / clear)\n"
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

    try:
        while True:
            try:
                state = client.state()
            except Exception as e:
                console.print(f"[red]AD offline: {e}[/red]")
                time.sleep(max(1.0, poll_ms / 1000.0))
                continue

            throws = extract_throws(state)
            status = extract_status(state)

            if status and status != prev_status:
                console.print(
                    f"[cyan]status[/cyan] {prev_status or '—'} → [bold]{status}[/bold]"
                )
                if is_takeout_status(status) and not is_takeout_status(prev_status):
                    maybe_end_turn(f"status={status}")
                prev_status = status

            # New visit after empty board — allow end-turn again
            if throws and not prev_throws:
                end_turn_sent = False

            # Appended darts (idempotent: unchanged poll → nothing)
            fresh = new_throws_since(prev_throws, throws)
            for dart in fresh:
                label = format_segment_label(dart)
                kind, number = dart_to_no3(dart)
                payload: dict[str, Any] = {
                    "kind": kind,
                    "number": number,
                    "roomId": room,
                    "confidence": 0.99,
                }
                for src, dst in (("angle", "angle"), ("radius", "radius")):
                    if isinstance(dart.get(src), (int, float)):
                        payload[dst] = float(dart[src])

                console.print(f"[green]AD[/green] {label} → No3 {kind} {number}")
                resp = _post_json(dart_url, payload, headers, dry_run)
                if resp is not None:
                    callout = resp.get("callout") if isinstance(resp, dict) else None
                    if callout:
                        console.print(f"[bold green]POST OK[/bold green] {callout}")
                    else:
                        console.print("[bold green]POST OK[/bold green]")
                    # 3rd dart usually auto-ends in No3
                    if resp.get("turnEnded"):
                        end_turn_sent = True

            if visit_cleared(prev_throws, throws):
                console.print("[dim]AD throws cleared[/dim]")
                maybe_end_turn("throws cleared")
                end_turn_sent = False
            elif prev_throws and throws and len(throws) < len(prev_throws):
                console.print("[dim]AD throw list shrank — resetting visit[/dim]")
                maybe_end_turn("throw list shrank")
                end_turn_sent = False

            prev_throws = list(throws)
            time.sleep(max(0.05, poll_ms / 1000.0))
    except KeyboardInterrupt:
        console.print("Bridge stopped.")
