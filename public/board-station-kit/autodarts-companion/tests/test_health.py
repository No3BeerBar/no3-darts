"""Health tracker thresholds."""

from __future__ import annotations

from companion.health import (
    HealthConfig,
    HealthTracker,
    no3_match_allows_between_games_recal,
)


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


def test_between_games_recal_requires_match_gate() -> None:
    t = HealthTracker(HealthConfig(between_games_recal=True))
    # Same AD signal that used to fire every visit - blocked without No3 gate
    assert not t.should_recal_between_games(
        "Takeout finished", [], "Takeout", match_allows_recal=False
    )
    assert t.should_recal_between_games(
        "Takeout finished", [], "Takeout", match_allows_recal=True
    )
    t.mark_recal()
    # Cooldown
    assert not t.should_recal_between_games(
        "Takeout finished", [], "Takeout", match_allows_recal=True
    )


def test_between_games_recal_on_visit_cleared_after_takeout() -> None:
    t = HealthTracker(HealthConfig(between_games_recal=True))
    assert t.should_recal_between_games(
        "Takeout",
        [],
        "Takeout",
        visit_just_cleared=True,
        match_allows_recal=True,
    )
    assert not t.should_recal_between_games(
        "Throw",
        [],
        "Throw",
        visit_just_cleared=True,
        match_allows_recal=True,
    )


def test_between_games_skips_when_darts_still_in() -> None:
    t = HealthTracker(HealthConfig(between_games_recal=True))
    assert not t.should_recal_between_games(
        "Takeout finished",
        [{"x": 1}],
        "Takeout",
        match_allows_recal=True,
    )


def test_no3_match_allows_between_games_recal() -> None:
    assert no3_match_allows_between_games_recal(None) is True
    # Null match after a recent playing sighting must fail closed (mid-game)
    assert (
        no3_match_allows_between_games_recal(None, recently_playing=True) is False
    )
    assert no3_match_allows_between_games_recal({"status": "playing"}) is False
    assert no3_match_allows_between_games_recal({"status": "paused"}) is False
    assert no3_match_allows_between_games_recal({"status": "leg_won"}) is True
    assert no3_match_allows_between_games_recal({"status": "match_won"}) is True
    assert no3_match_allows_between_games_recal({"status": "finished"}) is True
    assert no3_match_allows_between_games_recal({"status": "setup"}) is True
    assert no3_match_allows_between_games_recal({"status": "mystery"}) is False
