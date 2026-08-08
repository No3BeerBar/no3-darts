"""CLI: python -m companion spy|probe|compare|viz"""

from __future__ import annotations

import argparse
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
        description="Run beside Autodarts Board Manager and log/compare detections"
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

    p_viz = sub.add_parser("viz", help="Live board diagram of Autodarts hits")
    p_viz.add_argument("--host", default=None)
    p_viz.add_argument("--port", type=int, default=None)

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
            no3_url=args.no3_url or no3.get("url") or "http://localhost:3000",
            room=args.room or no3.get("room_id") or "Board 1",
            dump=bool(args.dump),
            logs_dir=logs_dir,
        )
        return

    if args.cmd == "viz":
        from .viz import run_viz

        run_viz(host=host, port=port, poll_ms=poll_ms)
        return

    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
