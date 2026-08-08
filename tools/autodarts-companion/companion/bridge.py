"""
Autodarts → No3 score bridge.

When Autodarts Board Manager is the reliable detector, mirror its throws
into No3 so the bar app / TV still work while we improve DIY CV.
"""

from __future__ import annotations

import time
from typing import Any

import requests
from rich.console import Console

from .client import AutodartsClient, extract_throws, format_dart, throws_signature

console = Console()


def _label_to_kind_number(label: str) -> tuple[str, int]:
    lab = label.upper().strip()
    if lab in ("BULL", "DBULL", "DB", "50"):
        return "bull", 50
    if lab in ("25", "SBULL", "OUTER", "SB"):
        return "outer_bull", 25
    if lab in ("MISS", "0", "M"):
        return "miss", 0
    if lab.startswith("T") and lab[1:].isdigit():
        return "triple", int(lab[1:])
    if lab.startswith("D") and lab[1:].isdigit():
        n = int(lab[1:])
        if n == 25:
            return "bull", 50
        return "double", n
    if lab.startswith("S") and lab[1:].isdigit():
        return "single", int(lab[1:])
    if lab.isdigit():
        return "single", int(lab)
    return "miss", 0


def run_bridge(
    host: str,
    port: int,
    no3_url: str,
    room: str,
    poll_ms: int = 250,
    api_key: str = "",
    dry_run: bool = False,
) -> None:
    client = AutodartsClient(host, port)
    no3_url = no3_url.rstrip("/")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    console.print(
        f"[bold]Autodarts → No3 bridge[/bold]\n"
        f"  AD:  http://{host}:{port}\n"
        f"  No3: {no3_url}  room={room!r}\n"
        f"  dry_run={dry_run}\n"
        "Throw with Autodarts detecting. Scores are posted to No3.\n"
    )

    last_sig = ""
    try:
        while True:
            try:
                state = client.state()
            except Exception as e:
                console.print(f"[red]AD offline: {e}[/red]")
                time.sleep(1)
                continue

            throws = extract_throws(state)
            sig = throws_signature(throws)
            if sig != last_sig and throws:
                last = throws[-1]
                label = format_dart(last)
                kind, number = _label_to_kind_number(label)
                payload: dict[str, Any] = {
                    "kind": kind,
                    "number": number,
                    "roomId": room,
                    "confidence": 0.99,
                }
                console.print(
                    f"[green]AD[/green] {label} → No3 {kind} {number}"
                )
                if dry_run:
                    console.print(f"[dim]dry_run payload {payload}[/dim]")
                else:
                    try:
                        r = requests.post(
                            f"{no3_url}/api/camera/dart",
                            json=payload,
                            headers=headers,
                            timeout=5,
                        )
                        if r.status_code >= 400:
                            console.print(f"[red]No3 HTTP {r.status_code}: {r.text[:200]}[/red]")
                        else:
                            console.print(f"[bold green]POST OK[/bold green] {r.json().get('callout')}")
                    except Exception as e:
                        console.print(f"[red]No3 post failed: {e}[/red]")
                last_sig = sig
            elif sig != last_sig:
                # cleared
                last_sig = sig
                console.print("[dim]AD throws cleared[/dim]")

            time.sleep(poll_ms / 1000.0)
    except KeyboardInterrupt:
        console.print("Bridge stopped.")
