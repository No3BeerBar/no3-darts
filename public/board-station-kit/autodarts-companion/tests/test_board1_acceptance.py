"""
Board 1 / camera-bridge acceptance net (companion side).

Pairs with src/lib/board1-acceptance.test.ts. Encodes the bar P0 invariants
that live in the Autodarts bridge so they FAIL if regressed:

  - takeout pauses scoring (scoring_frozen)
  - between-games recal gated when No3 match is playing
  - 3-dart visit must not end-turn before dart 3 (defer helpers)
"""

from __future__ import annotations

from companion.bridge import fetch_no3_match_allows_recal
from companion.health import (
    HealthConfig,
    HealthTracker,
    no3_match_allows_between_games_recal,
)
from companion.mapping import is_takeout_status
from companion.visit_gate import (
    scoring_frozen,
    should_end_turn_on_takeout,
)


def test_board1_takeout_pauses_scoring() -> None:
    """AD Takeout* statuses freeze dart/correct posts."""
    assert is_takeout_status("Takeout")
    assert is_takeout_status("Takeout started")
    assert is_takeout_status("Takeout finished")
    assert scoring_frozen(takeout=True, visit_closed=False) is True
    assert scoring_frozen(takeout=False, visit_closed=True) is True
    assert scoring_frozen(takeout=False, visit_closed=False) is False


def test_board1_between_games_recal_gated_when_match_playing() -> None:
    """Ordinary visit takeout while playing must not recalibrate."""
    assert no3_match_allows_between_games_recal({"status": "playing"}) is False
    assert no3_match_allows_between_games_recal({"status": "paused"}) is False
    assert no3_match_allows_between_games_recal({"status": "leg_won"}) is True
    assert no3_match_allows_between_games_recal(None) is True

    t = HealthTracker(HealthConfig(between_games_recal=True))
    assert not t.should_recal_between_games(
        "Takeout finished", [], "Takeout", match_allows_recal=False
    )
    assert t.should_recal_between_games(
        "Takeout finished", [], "Takeout", match_allows_recal=True
    )

    # dry_run must fail closed (no pretend between-games window)
    assert (
        fetch_no3_match_allows_recal(
            "http://localhost:3000", "Board 1", {}, dry_run=True
        )
        is False
    )


def test_board1_end_turn_defers_until_three_throws() -> None:
    """Bridge must not end-turn on takeout with only 1-2 throws mirrored."""
    assert should_end_turn_on_takeout(visit_closed=False, throws_count=1) is False
    assert should_end_turn_on_takeout(visit_closed=False, throws_count=2) is False
    assert should_end_turn_on_takeout(visit_closed=False, throws_count=3) is True
    assert should_end_turn_on_takeout(visit_closed=True, throws_count=3) is False
