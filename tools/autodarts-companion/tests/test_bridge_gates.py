"""Bridge No3 match gate + takeout helpers (no network)."""

from __future__ import annotations

from companion.bridge import fetch_no3_match_allows_recal
from companion.health import no3_match_allows_between_games_recal
from companion.mapping import is_takeout_status


def test_takeout_status_pauses_scoring_signals() -> None:
    assert is_takeout_status("Takeout")
    assert is_takeout_status("Takeout started")
    assert is_takeout_status("Hand")
    assert is_takeout_status("Partial Takeout")
    # Finished means board clear - not active remove-darts
    assert not is_takeout_status("Takeout finished")
    assert not is_takeout_status("Throw")
    assert not is_takeout_status("Throw detected")


def test_dry_run_fetch_match_gate_fails_closed() -> None:
    # dry_run must not pretend a between-games window exists
    assert (
        fetch_no3_match_allows_recal(
            "http://localhost:3000", "Board 1", {}, dry_run=True
        )
        is False
    )


def test_match_gate_table() -> None:
    cases = [
        (None, True),
        ({"status": "playing"}, False),
        ({"status": "paused"}, False),
        ({"status": "leg_won"}, True),
        ({"status": "match_won"}, True),
    ]
    for match, expected in cases:
        assert no3_match_allows_between_games_recal(match) is expected
