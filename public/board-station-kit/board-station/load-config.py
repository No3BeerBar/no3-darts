#!/usr/bin/env python3
"""Load board-station config.yaml and print JSON for Start-Board.ps1."""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML missing - pip install pyyaml", file=sys.stderr)
    sys.exit(2)


DEFAULTS = {
    "autodarts": {
        "host": "127.0.0.1",
        "port": 3180,
        "exe_path": "",
        "process_names": ["Autodarts", "autodarts", "AutodartsDesktop"],
        "start_if_missing": True,
        "ready_timeout_s": 45,
    },
    "no3": {
        "url": "http://localhost:3000",
        "room_id": "Board 1",
        "camera_api_key": "",
    },
    "bridge": {
        "enabled": True,
        "companion_dir": "../autodarts-companion",
    },
    "kiosk": {
        "enabled": True,
        "browser": "msedge",
        "open_tv": True,
        "tv_url": "{no3.url}/tv",
        "open_play": False,
        "play_url": "{no3.url}/play",
        "extra_args": "--autoplay-policy=no-user-gesture-required",
        "tv_display": 1,
    },
    "health": {
        "enabled": True,
        "fps_min": 5.0,
        "unhealthy_seconds": 15.0,
        "restart_cooldown_seconds": 60.0,
        "between_games_recal": True,
    },
}


def deep_merge(base: dict, overlay: dict) -> dict:
    out = dict(base)
    for k, v in (overlay or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "config.yaml")
    if not path.is_file():
        print(f"missing config: {path}", file=sys.stderr)
        return 1
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    cfg = deep_merge(DEFAULTS, raw)
    json.dump(cfg, sys.stdout, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
