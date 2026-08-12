"""Visit / takeout freeze gates (3-dart visit must stay on one seat)."""

from __future__ import annotations

import json
from pathlib import Path

from companion.client import diff_visit, extract_throws, VISIT_APPEND
from companion.visit_gate import (
    is_takeout_state,
    scoring_frozen,
    should_end_turn_on_clear,
    should_unlock_next_visit,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _seg(name: str, number: int, mult: int) -> dict:
    return {"segment": {"name": name, "number": number, "multiplier": mult}}


def test_fixture_takeout_keeps_throws() -> None:
    """Real AD signal: Takeout status while prior visit still in throws[]."""
    state = _load("state_three_darts.json")
    assert is_takeout_state(state) is True
    assert len(extract_throws(state)) == 3
    assert scoring_frozen(takeout=True, visit_closed=False) is True


def test_event_only_takeout_detected() -> None:
    assert is_takeout_state({"status": "Throw", "event": "Takeout"}) is True
    assert is_takeout_state({"status": "Throw detected", "event": "Dart"}) is False


def test_visit_closed_freezes_without_takeout_status() -> None:
    assert scoring_frozen(takeout=False, visit_closed=True) is True
    assert scoring_frozen(takeout=False, visit_closed=False) is False


def test_clear_does_not_end_turn_mid_throw() -> None:
    # Flicker empty between dart 2 and dart 3
    assert (
        should_end_turn_on_clear(
            takeout=False, in_takeout=False, visit_closed=False
        )
        is False
    )
    assert (
        should_end_turn_on_clear(
            takeout=True, in_takeout=False, visit_closed=False
        )
        is True
    )
    assert (
        should_end_turn_on_clear(
            takeout=False, in_takeout=True, visit_closed=False
        )
        is True
    )
    assert (
        should_end_turn_on_clear(
            takeout=False, in_takeout=False, visit_closed=True
        )
        is True
    )


def test_unlock_requires_takeout_handshake_or_scored_close() -> None:
    # Empty + not takeout alone is not enough (prevents dart-3-on-P2 after flicker)
    assert (
        should_unlock_next_visit(
            visit_closed=True,
            takeout=False,
            throws_empty=True,
            saw_takeout_after_close=False,
            closed_by_scoring=False,
        )
        is False
    )
    assert (
        should_unlock_next_visit(
            visit_closed=True,
            takeout=False,
            throws_empty=True,
            saw_takeout_after_close=True,
            closed_by_scoring=False,
        )
        is True
    )
    assert (
        should_unlock_next_visit(
            visit_closed=True,
            takeout=False,
            throws_empty=True,
            saw_takeout_after_close=False,
            closed_by_scoring=True,
        )
        is True
    )
    assert (
        should_unlock_next_visit(
            visit_closed=True,
            takeout=True,
            throws_empty=True,
            saw_takeout_after_close=True,
            closed_by_scoring=True,
        )
        is False
    )


def test_three_dart_growth_is_append_not_new_visit() -> None:
    """1 -> 2 -> 3 throws must be append growth on one visit."""
    t1 = [_seg("T20", 20, 3)]
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    t3 = extract_throws(_load("state_three_darts.json"))
    assert len(t3) == 3

    d12 = diff_visit(t1, t2)
    assert d12["kind"] == VISIT_APPEND
    assert len(d12["appended"]) == 1

    d23 = diff_visit(t2, t3)
    assert d23["kind"] == VISIT_APPEND
    assert len(d23["appended"]) == 1
    # Full visit still one list - never a separate "next player" visit
    assert len(d23["throws"]) == 3


def test_takeout_with_three_throws_same_poll_still_one_visit() -> None:
    """
    AD often flips to Takeout in the same poll that adds dart 3.

    Bridge must treat this as append of dart 3 onto the current seat first,
    then end-turn - not end-turn with only 2 darts already posted.
    """
    prev = [
        _seg("T20", 20, 3),
        _seg("5", 5, 1),
    ]
    state = _load("state_three_darts.json")
    curr = extract_throws(state)
    assert is_takeout_state(state) is True
    diff = diff_visit(prev, curr)
    assert diff["kind"] == VISIT_APPEND
    assert len(diff["appended"]) == 1
    # Same-poll takeout must not imply a new visit boundary for scoring
    assert scoring_frozen(takeout=True, visit_closed=False) is True
    # ...but throw sync uses visit_closed only (not takeout) so dart 3 posts


def test_throw_fixture_not_takeout() -> None:
    state = _load("state_throw.json")
    assert is_takeout_state(state) is False
    assert extract_throws(state) == []
