"""
Camera / Board Manager health helpers for the Autodarts -> No3 bridge.

Uses local HTTP + OS process management only (no Autodarts CV reverse-engineering).
"""

from __future__ import annotations

import os
import platform
import subprocess
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from rich.console import Console

from .client import AutodartsClient, extract_camera_health

console = Console()


@dataclass
class HealthConfig:
    """Thresholds for unhealthy detection and restart policy."""

    enabled: bool = True
    fps_min: float = 5.0
    unhealthy_seconds: float = 15.0
    restart_cooldown_seconds: float = 60.0
    between_games_recal: bool = True
    # Editable path - set in config.yaml / board-station config
    exe_path: str = ""
    process_names: list[str] = field(
        default_factory=lambda: ["Autodarts", "autodarts", "AutodartsDesktop"]
    )


@dataclass
class HealthTracker:
    config: HealthConfig
    unhealthy_since: Optional[float] = None
    last_restart_at: float = 0.0
    last_status: str = "unknown"
    last_payload: dict[str, Any] = field(default_factory=dict)
    last_recal_at: float = 0.0
    consecutive_offline: int = 0

    def evaluate(self, state: Optional[dict[str, Any]], ad_reachable: bool) -> dict[str, Any]:
        """
        Evaluate health from a state snapshot (or offline).

        Returns a payload suitable for POST /api/camera/health.
        """
        now = time.time()
        if not ad_reachable or state is None:
            self.consecutive_offline += 1
            snap = {
                "ok": False,
                "reason": "board_manager_offline",
                "fps": [],
                "min_fps": None,
                "cameras": [],
                "connected": False,
                "status": "",
            }
        else:
            self.consecutive_offline = 0
            snap = extract_camera_health(state)
            # Apply configured FPS floor when telemetry exists
            min_fps = snap.get("min_fps")
            if (
                snap.get("ok")
                and isinstance(min_fps, (int, float))
                and min_fps < self.config.fps_min
            ):
                snap["ok"] = False
                snap["reason"] = "fps_below_threshold"

        if snap.get("ok"):
            self.unhealthy_since = None
            level = "ok"
            message = "Cameras healthy"
        else:
            if self.unhealthy_since is None:
                self.unhealthy_since = now
            elapsed = now - self.unhealthy_since
            if elapsed >= self.config.unhealthy_seconds:
                level = "unhealthy"
                message = _message_for(snap.get("reason") or "unhealthy")
            else:
                level = "degraded"
                message = _message_for(snap.get("reason") or "degraded")

        payload = {
            **snap,
            "level": level,
            "message": message,
            "unhealthy_for_s": (
                round(now - self.unhealthy_since, 1) if self.unhealthy_since else 0
            ),
            "ts": int(now * 1000),
        }
        self.last_status = level
        self.last_payload = payload
        return payload

    def should_restart(self) -> bool:
        if not self.config.enabled:
            return False
        if self.last_status != "unhealthy":
            return False
        now = time.time()
        if now - self.last_restart_at < self.config.restart_cooldown_seconds:
            return False
        return True

    def mark_restart(self) -> None:
        self.last_restart_at = time.time()
        self.unhealthy_since = None

    def should_recal_between_games(
        self,
        status: str,
        throws: list[Any],
        prev_status: str,
        *,
        visit_just_cleared: bool = False,
    ) -> bool:
        """
        True once when the board is empty in a safe between-games window:
        - status becomes Takeout finished (empty throws), or
        - status returns to Throw after takeout (empty throws), or
        - throws list just cleared while status is/was takeout.
        """
        if not self.config.between_games_recal:
            return False
        if throws:
            return False
        now = time.time()
        if now - self.last_recal_at < 30.0:
            return False
        s = (status or "").strip().lower()
        prev = (prev_status or "").strip().lower()
        finished = "takeout finished" in s or s == "takeoutfinished"
        entered_throw = s in ("throw", "throw detected") and "takeout" in prev
        cleared_after_takeout = visit_just_cleared and (
            "takeout" in s or "takeout" in prev
        )
        return bool(finished or entered_throw or cleared_after_takeout)

    def mark_recal(self) -> None:
        self.last_recal_at = time.time()


def _message_for(reason: str) -> str:
    mapping = {
        "board_manager_offline": "Detection offline - restarting...",
        "camera_disconnected": "Cameras unhealthy",
        "fps_zero": "Cameras unhealthy (0 FPS)",
        "fps_low": "Cameras unhealthy (low FPS)",
        "fps_below_threshold": "Cameras unhealthy (low FPS)",
        "invalid_state": "Detection restarting...",
        "unhealthy": "Cameras unhealthy",
        "degraded": "Cameras degraded...",
    }
    return mapping.get(reason, "Cameras unhealthy")


def restart_board_manager(cfg: HealthConfig) -> dict[str, Any]:
    """
    Restart Autodarts Board Manager process (Windows-first).

    Uses editable exe_path + process_names from config - never hardcodes a
    machine-specific install path without an override.
    """
    system = platform.system().lower()
    killed: list[str] = []
    started = False
    error = ""

    names = [n for n in (cfg.process_names or []) if n]
    exe = (cfg.exe_path or os.environ.get("AUTODARTS_EXE") or "").strip()

    try:
        if system == "windows":
            for name in names:
                # taskkill by image name (with and without .exe)
                image = name if name.lower().endswith(".exe") else f"{name}.exe"
                subprocess.run(
                    ["taskkill", "/IM", image, "/F"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                killed.append(image)
            if exe and os.path.isfile(exe):
                subprocess.Popen(
                    [exe],
                    cwd=os.path.dirname(exe) or None,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                started = True
            elif exe:
                error = f"exe_path not found: {exe}"
            else:
                error = "exe_path not set - killed processes only; start Board Manager manually"
        else:
            # Dev / CI: best-effort pkill; no Autodarts on Linux typically
            for name in names:
                subprocess.run(
                    ["pkill", "-f", name],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                killed.append(name)
            if exe and os.path.isfile(exe):
                subprocess.Popen(
                    [exe],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                started = True
            else:
                error = error or "non-Windows: process restart is best-effort"
    except Exception as e:
        error = str(e)

    result = {
        "ok": started or bool(killed),
        "killed": killed,
        "started": started,
        "exe_path": exe,
        "error": error,
    }
    console.print(f"[yellow]Board Manager restart[/yellow] {result}")
    return result


def wait_for_board_manager(
    client: AutodartsClient,
    timeout_s: float = 45.0,
    poll_s: float = 1.5,
) -> bool:
    """Poll until /api/state responds or timeout."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            client.state()
            return True
        except Exception:
            time.sleep(poll_s)
    return False
