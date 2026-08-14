"""Bridge No3 match gate + takeout helpers (no network)."""

from __future__ import annotations

from companion.bridge import build_end_turn_payload, fetch_no3_match_allows_recal
from companion.health import no3_match_allows_between_games_recal
from companion.mapping import is_takeout_status


def test_takeout_status_pauses_scoring_signals() -> None:
    assert is_takeout_status("Takeout")
    assert is_takeout_status("Takeout started")
    assert is_takeout_status("Hand")
    assert is_takeout_status("Partial Takeout")
    assert is_takeout_status("Reset")
    assert is_takeout_status("Board reset")
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


def test_end_turn_payload_never_omits_expected_player_index() -> None:
    """maybe_end_turn must fail closed when seat is unknown."""
    assert build_end_turn_payload("Board 1", None) is None
    assert build_end_turn_payload("Board 1", 0) == {
        "roomId": "Board 1",
        "expectedPlayerIndex": 0,
    }
    assert build_end_turn_payload("Board 1", 1) == {
        "roomId": "Board 1",
        "expectedPlayerIndex": 1,
    }
    # Invalid seat values refuse the post entirely
    assert build_end_turn_payload("Board 1", "x") is None  # type: ignore[arg-type]


def test_ad_offline_clears_sticky_takeout_health() -> None:
    """Sandbox / AD unreachable must not leave Pull-darts sticky on No3."""
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "companion" / "bridge.py"
    text = src.read_text(encoding="utf-8")
    assert "AD unreachable: ALWAYS clear sticky takeout" in text
    assert '"connected": False' in text
    assert 'post_health(' in text
    assert '"takeout": False' in text
    assert "in_takeout = False" in text
    # Ready/Reset ack must still run while AD is offline
    assert "handle_takeout_ready_ack(prev_status or \"\", [])" in text
    # Never arm takeout:true without a fresh AD takeout read, unless the
    # visit is already frozen (silent hold after undo/correct).
    assert "ad_takeout: bool = False" in text
    assert "if active and not ad_ok:" in text
    assert "if active and not ad_takeout and not frozen_visit:" in text
