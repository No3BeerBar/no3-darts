"""Compare Autodarts throws to No3 active match / recent camera activity."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.request import Request, urlopen

from rich.console import Console

from .client import AutodartsClient, extract_throws, format_dart, throws_signature

console = Console()


def _get_json(url: str, timeout: float = 3.0) -> Any:
    req = Request(url, headers={"Accept": "application/json"})
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def run_compare(
    host: str,
    port: int,
    no3_url: str,
    room: str,
    poll_ms: int = 300,
    dump: bool = False,
    logs_dir: Path | str = "./logs",
) -> None:
    client = AutodartsClient(host, port)
    no3_url = no3_url.rstrip("/")
    logs_dir = Path(logs_dir)
    logs_dir.mkdir(parents=True, exist_ok=True)
    session = logs_dir / f"compare-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jsonl"
    dump_fp = open(session, "a", encoding="utf-8") if dump else None

    console.print(
        f"[bold]Compare mode[/bold]\n"
        f"  Autodarts: http://{host}:{port}\n"
        f"  No3:       {no3_url}  room={room!r}\n"
        f"Throw with Autodarts running. We log AD scores and current No3 match snapshot.\n"
    )

    last_sig = ""
    try:
        while True:
            try:
                state = client.state()
            except Exception as e:
                console.print(f"[red]AD poll: {e}[/red]")
                time.sleep(1)
                continue

            throws = extract_throws(state)
            sig = throws_signature(throws)
            if sig != last_sig and throws:
                ad_label = format_dart(throws[-1])
                no3_snap: Optional[dict] = None
                try:
                    no3_snap = _get_json(
                        f"{no3_url}/api/matches/active?room={room.replace(' ', '%20')}"
                    )
                except Exception as e:
                    no3_snap = {"error": str(e)}

                match = (no3_snap or {}).get("match") if isinstance(no3_snap, dict) else None
                turn = []
                if isinstance(match, dict):
                    turn = match.get("currentTurnDarts") or []
                no3_labels = []
                for d in turn:
                    if isinstance(d, dict):
                        k = d.get("kind", "")
                        n = d.get("number", "")
                        no3_labels.append(f"{k}:{n}")

                console.print(
                    f"[green]AD[/green] {ad_label}   "
                    f"[cyan]No3 turn[/cyan] {no3_labels or '(empty / no match)'}"
                )
                if dump_fp:
                    dump_fp.write(
                        json.dumps(
                            {
                                "ts": datetime.now(timezone.utc).isoformat(),
                                "autodarts_dart": throws[-1],
                                "autodarts_label": ad_label,
                                "no3": no3_snap,
                            },
                            ensure_ascii=False,
                            default=str,
                        )
                        + "\n"
                    )
                    dump_fp.flush()
                last_sig = sig
            elif sig != last_sig:
                last_sig = sig

            time.sleep(poll_ms / 1000.0)
    except KeyboardInterrupt:
        console.print("Stopped.")
    finally:
        if dump_fp:
            dump_fp.close()
