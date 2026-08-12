"""Live poll of Autodarts Board Manager."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.table import Table

from .client import (
    AutodartsClient,
    dart_coords,
    extract_status,
    extract_throws,
    format_dart,
    throws_signature,
)

console = Console()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def run_spy(
    host: str,
    port: int,
    poll_ms: int = 300,
    dump: bool = False,
    logs_dir: Path | str = "./logs",
) -> None:
    client = AutodartsClient(host, port)
    logs_dir = Path(logs_dir)
    logs_dir.mkdir(parents=True, exist_ok=True)
    session = logs_dir / f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jsonl"
    dump_fp = open(session, "a", encoding="utf-8") if dump else None

    console.print(
        Panel.fit(
            f"[bold]Autodarts spy[/bold]\n"
            f"Board Manager: http://{host}:{port}\n"
            f"Poll every {poll_ms} ms\n"
            f"Dump: {session if dump else 'off'}\n\n"
            "Start Autodarts, open Board Manager, press Start, then throw.\n"
            "Ctrl+C to stop.",
            title="companion spy",
        )
    )

    # One-shot endpoint probe summary
    try:
        client.probe()
    except Exception as e:
        console.print(f"[yellow]probe: {e}[/yellow]")

    last_sig = ""
    last_status = ""
    history: list[str] = []

    try:
        while True:
            try:
                state = client.state()
            except Exception as e:
                console.print(f"[red]poll failed: {e}[/red]")
                time.sleep(max(poll_ms, 500) / 1000.0)
                continue

            throws = extract_throws(state)
            status = extract_status(state)
            sig = throws_signature(throws)

            if status and status != last_status:
                console.print(f"[cyan]status[/cyan] {last_status or '—'} → [bold]{status}[/bold]")
                last_status = status

            if sig != last_sig:
                # New or changed throws
                if len(throws) > 0:
                    last = throws[-1]
                    label = format_dart(last)
                    coords = dart_coords(last)
                    extra = f"  coords={coords}" if coords else ""
                    # dump all keys of last dart once so we learn the schema
                    keys = sorted(last.keys()) if isinstance(last, dict) else []
                    console.print(
                        f"[bold green]DART[/bold green] #{len(throws)}  "
                        f"[bold]{label}[/bold]{extra}"
                    )
                    console.print(f"[dim]  dart keys: {keys}[/dim]")
                    history.append(f"{label}{extra}")
                    if len(history) > 12:
                        history = history[-12:]
                else:
                    console.print("[dim]throws cleared (takeout / reset)[/dim]")
                    history.clear()
                last_sig = sig

                if dump_fp:
                    dump_fp.write(
                        json.dumps(
                            {
                                "ts": _now(),
                                "status": status,
                                "throws_count": len(throws),
                                "throws": throws,
                                "state": state,
                            },
                            ensure_ascii=False,
                            default=str,
                        )
                        + "\n"
                    )
                    dump_fp.flush()

            time.sleep(poll_ms / 1000.0)
    except KeyboardInterrupt:
        console.print("\n[yellow]Stopped.[/yellow]")
    finally:
        if dump_fp:
            dump_fp.close()
            console.print(f"Log saved: {session}")
