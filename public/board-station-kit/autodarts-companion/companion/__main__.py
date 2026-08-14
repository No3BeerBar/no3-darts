"""CLI: python -m companion spy|probe|compare|viz|bridge"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from rich.console import Console

console = Console()


def _load_cfg(path: str | None) -> dict:
    import yaml

    p = Path(path or "config.yaml")
    if not p.exists():
        p = Path(__file__).resolve().parent.parent / "config.example.yaml"
    return yaml.safe_load(p.read_text()) or {}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Autodarts Board Manager companion - spy, compare, or bridge "
            "throws into No3 (Autodarts detects; No3 scores)."
        )
    )
    parser.add_argument("--config", default="config.yaml")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_spy = sub.add_parser("spy", help="Poll Autodarts /api/state and print throws")
    p_spy.add_argument("--host", default=None)
    p_spy.add_argument("--port", type=int, default=None)
    p_spy.add_argument("--dump", action="store_true", help="Write JSONL dumps to logs/")
    p_spy.add_argument("--poll-ms", type=int, default=None)

    p_probe = sub.add_parser("probe", help="Discover Board Manager HTTP endpoints")
    p_probe.add_argument("--host", default=None)
    p_probe.add_argument("--port", type=int, default=None)

    p_cmp = sub.add_parser("compare", help="Compare Autodarts throws vs No3 posts")
    p_cmp.add_argument("--host", default=None)
    p_cmp.add_argument("--port", type=int, default=None)
    p_cmp.add_argument("--no3-url", default=None)
    p_cmp.add_argument("--room", default=None)
    p_cmp.add_argument("--dump", action="store_true")
    p_cmp.add_argument("--poll-ms", type=int, default=None)

    p_viz = sub.add_parser("viz", help="Live board diagram of Autodarts hits")
    p_viz.add_argument("--host", default=None)
    p_viz.add_argument("--port", type=int, default=None)
    p_viz.add_argument("--poll-ms", type=int, default=None)

    p_br = sub.add_parser(
        "bridge",
        help="Use Autodarts as detector: POST throws into No3 game UI",
        description=(
            "Poll Autodarts Board Manager and mirror each new dart into No3 "
            "via POST /api/camera/dart. Game modes (X01, Cricket, Killer, ...) "
            "stay in No3 - Autodarts only detects."
        ),
    )
    p_br.add_argument(
        "--host",
        default=None,
        help="Board Manager host (default: config / 127.0.0.1)",
    )
    p_br.add_argument(
        "--port",
        type=int,
        default=None,
        help="Board Manager port (default: config / 3180)",
    )
    p_br.add_argument(
        "--poll-ms",
        type=int,
        default=None,
        help="Poll interval in ms (default: config / 300)",
    )
    p_br.add_argument(
        "--no3-url",
        default=None,
        help="No3 base URL (or env NO3_URL)",
    )
    p_br.add_argument(
        "--room",
        default=None,
        help='Room id matching the No3 match (e.g. "Board 1")',
    )
    p_br.add_argument(
        "--api-key",
        default="",
        help="CAMERA_API_KEY (or env CAMERA_API_KEY)",
    )
    p_br.add_argument(
        "--dry-run",
        action="store_true",
        help="Log payloads without POSTing to No3",
    )
    p_br.add_argument(
        "--no-end-turn",
        action="store_true",
        help="Do not call POST /api/camera/end-turn on Autodarts takeout",
    )
    p_br.add_argument(
        "--no-health",
        action="store_true",
        help="Disable camera health watch / Board Manager auto-restart",
    )
    p_br.add_argument(
        "--no-keep-alive",
        action="store_true",
        help="Disable idle-timer keep-alive (do not auto-start a stopped board)",
    )

    args = parser.parse_args(argv)
    cfg = _load_cfg(args.config)
    ad = cfg.get("autodarts") or {}
    host = getattr(args, "host", None) or ad.get("host") or "127.0.0.1"
    port = getattr(args, "port", None) or int(ad.get("port") or 3180)
    poll_ms = getattr(args, "poll_ms", None) or int(ad.get("poll_ms") or 300)
    logs_dir = Path(cfg.get("logs_dir") or "./logs")

    if args.cmd == "probe":
        from .client import AutodartsClient

        client = AutodartsClient(host, port)
        client.probe()
        return

    if args.cmd == "spy":
        from .spy import run_spy

        run_spy(
            host=host,
            port=port,
            poll_ms=poll_ms,
            dump=bool(args.dump),
            logs_dir=logs_dir,
        )
        return

    if args.cmd == "compare":
        no3 = cfg.get("no3") or {}
        from .compare import run_compare

        run_compare(
            host=host,
            port=port,
            poll_ms=poll_ms,
            no3_url=args.no3_url
            or no3.get("url")
            or os.environ.get("NO3_URL")
            or "http://localhost:3000",
            room=args.room or no3.get("room_id") or "Board 1",
            dump=bool(args.dump),
            logs_dir=logs_dir,
        )
        return

    if args.cmd == "viz":
        from .viz import run_viz

        run_viz(host=host, port=port, poll_ms=poll_ms)
        return

    if args.cmd == "bridge":
        no3 = cfg.get("no3") or {}
        hcfg_raw = cfg.get("health") or {}
        from .bridge import run_bridge
        from .health import HealthConfig
        from .keepalive import KeepAliveConfig

        health = HealthConfig(
            enabled=not bool(args.no_health)
            and bool(hcfg_raw.get("enabled", True)),
            fps_min=float(hcfg_raw.get("fps_min") or 5.0),
            unhealthy_seconds=float(hcfg_raw.get("unhealthy_seconds") or 15.0),
            restart_cooldown_seconds=float(
                hcfg_raw.get("restart_cooldown_seconds") or 60.0
            ),
            between_games_recal=bool(hcfg_raw.get("between_games_recal", True)),
            exe_path=str(
                hcfg_raw.get("exe_path")
                or ad.get("exe_path")
                or os.environ.get("AUTODARTS_EXE")
                or ""
            ),
            process_names=list(
                hcfg_raw.get("process_names")
                or ad.get("process_names")
                or ["Autodarts", "autodarts", "AutodartsDesktop"]
            ),
        )
        ka_raw = cfg.get("keep_alive") or {}
        keep_alive = KeepAliveConfig(
            enabled=not bool(args.no_keep_alive)
            and bool(ka_raw.get("enabled", ad.get("keep_alive", True))),
            interval_s=float(
                ka_raw.get("interval_s")
                or ad.get("keep_alive_interval_s")
                or 10.0
            ),
            start_cooldown_s=float(
                ka_raw.get("start_cooldown_s")
                or ad.get("keep_alive_start_cooldown_s")
                or 30.0
            ),
            board_id=str(
                ka_raw.get("board_id")
                or ad.get("board_id")
                or ""
            ).strip(),
        )

        run_bridge(
            host=host,
            port=port,
            no3_url=args.no3_url
            or no3.get("url")
            or os.environ.get("NO3_URL")
            or "http://localhost:3000",
            room=args.room or no3.get("room_id") or "Board 1",
            poll_ms=poll_ms,
            api_key=args.api_key
            or no3.get("camera_api_key")
            or os.environ.get("CAMERA_API_KEY")
            or "",
            dry_run=bool(args.dry_run),
            end_turn_on_takeout=not bool(args.no_end_turn),
            health=health,
            keep_alive=keep_alive,
        )
        return

    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
