"""Health tracker thresholds."""

from __future__ import annotations

from companion.health import HealthConfig, HealthTracker


def test_healthy_state_clears_timer() -> None:
    t = HealthTracker(HealthConfig(fps_min=5.0, unhealthy_seconds=0.01))
    p = t.evaluate({"status": "Throw", "cameras": [{"fps": 30}]}, True)
    assert p["level"] == "ok"
    assert t.unhealthy_since is None


def test_offline_becomes_unhealthy() -> None:
    t = HealthTracker(
        HealthConfig(unhealthy_seconds=0.0, restart_cooldown_seconds=60.0)
    )
    p = t.evaluate(None, False)
    assert p["ok"] is False
    assert p["level"] == "unhealthy"
    assert t.should_restart() is True
    t.mark_restart()
    assert t.should_restart() is False  # cooldown


def test_between_games_recal_on_takeout_finished() -> None:
    t = HealthTracker(HealthConfig(between_games_recal=True))
    assert t.should_recal_between_games("Takeout finished", [], "Takeout")
    t.mark_recal()
    # Cooldown
    assert not t.should_recal_between_games("Takeout finished", [], "Takeout")
