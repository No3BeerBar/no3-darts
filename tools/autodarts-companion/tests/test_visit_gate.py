"""Visit / takeout freeze gates (3-dart visit must stay on one seat)."""

from __future__ import annotations

import json
from pathlib import Path

from companion.client import diff_visit, extract_throws, VISIT_APPEND
from companion.visit_gate import (
    INCOMPLETE_VISIT_MIN_EMPTY_POLLS,
    is_ad_visit_continuation,
    is_takeout_state,
    scoring_frozen,
    seat_matches_lock,
    should_clear_stale_takeout,
    should_end_turn_on_clear,
    should_end_turn_on_empty_takeout_finished,
    should_end_turn_on_takeout,
    should_end_turn_leaving_takeout_empty,
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
    assert is_takeout_state({"status": "Throw", "event": "Hand"}) is True
    assert is_takeout_state({"status": "Throw", "event": "Partial Takeout"}) is True
    assert is_takeout_state({"status": "Throw detected", "event": "Dart"}) is False
    # Board State "Takeout finished" is complete - not active freeze
    assert is_takeout_state({"status": "Takeout finished", "event": "Empty"}) is False
    assert is_takeout_state({"status": "Takeout finished", "throws": []}) is False


def test_visit_closed_freezes_without_takeout_status() -> None:
    assert scoring_frozen(takeout=False, visit_closed=True) is True
    assert scoring_frozen(takeout=False, visit_closed=False) is False


def test_clear_does_not_end_turn_mid_throw() -> None:
    # Flicker empty between dart 2 and dart 3
    assert (
        should_end_turn_on_clear(
            takeout=False,
            in_takeout=False,
            visit_closed=False,
            prev_throw_count=2,
        )
        is False
    )
    # Incomplete visit + takeout clear flicker: wait for dart 3 / finished
    assert (
        should_end_turn_on_clear(
            takeout=True,
            in_takeout=False,
            visit_closed=False,
            prev_throw_count=2,
            takeout_finished=False,
        )
        is False
    )
    assert (
        should_end_turn_on_clear(
            takeout=False,
            in_takeout=True,
            visit_closed=False,
            prev_throw_count=2,
            takeout_finished=False,
        )
        is False
    )
    # Full visit already mirrored -> clear during takeout ends turn
    assert (
        should_end_turn_on_clear(
            takeout=True,
            in_takeout=True,
            visit_closed=False,
            prev_throw_count=3,
            takeout_finished=False,
        )
        is True
    )
    # P0: takeout_finished alone must NOT end incomplete visits (late dart 3)
    assert (
        should_end_turn_on_clear(
            takeout=True,
            in_takeout=True,
            visit_closed=False,
            prev_throw_count=2,
            takeout_finished=True,
        )
        is False
    )
    assert (
        should_end_turn_on_clear(
            takeout=False, in_takeout=False, visit_closed=True
        )
        is True
    )


def test_takeout_finished_empty_needs_sustained_polls() -> None:
    assert (
        should_end_turn_on_empty_takeout_finished(
            visit_closed=False,
            throws_empty=True,
            in_takeout=True,
            status="Takeout finished",
            empty_polls=1,
        )
        is False
    )
    assert (
        should_end_turn_on_empty_takeout_finished(
            visit_closed=False,
            throws_empty=True,
            in_takeout=True,
            status="Takeout finished",
            empty_polls=INCOMPLETE_VISIT_MIN_EMPTY_POLLS,
        )
        is True
    )


def test_takeout_defers_end_turn_until_three_throws() -> None:
    assert (
        should_end_turn_on_takeout(visit_closed=False, throws_count=2) is False
    )
    assert (
        should_end_turn_on_takeout(visit_closed=False, throws_count=3) is True
    )
    assert (
        should_end_turn_on_takeout(visit_closed=True, throws_count=3) is False
    )


def test_stale_takeout_clear_only_when_throws_remain() -> None:
    assert (
        should_clear_stale_takeout(
            takeout=False,
            in_takeout=True,
            visit_closed=False,
            throws_empty=False,
        )
        is True
    )
    assert (
        should_clear_stale_takeout(
            takeout=False,
            in_takeout=True,
            visit_closed=False,
            throws_empty=True,
        )
        is False
    )


def test_leaving_takeout_empty_needs_consecutive_polls() -> None:
    assert (
        should_end_turn_leaving_takeout_empty(
            visit_closed=False,
            throws_empty=True,
            in_takeout=True,
            takeout=False,
            empty_polls=2,
        )
        is False
    )
    assert (
        should_end_turn_leaving_takeout_empty(
            visit_closed=False,
            throws_empty=True,
            in_takeout=True,
            takeout=False,
            empty_polls=INCOMPLETE_VISIT_MIN_EMPTY_POLLS,
        )
        is True
    )


def test_seat_lock_and_continuation_helpers() -> None:
    assert seat_matches_lock(locked_seat=0, current_seat=1) is False
    assert seat_matches_lock(locked_seat=1, current_seat=1) is True
    closed = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    late = closed + [_seg("D16", 16, 2)]
    assert is_ad_visit_continuation(closed, late) is True
    assert is_ad_visit_continuation(closed, [_seg("T19", 19, 3)]) is False


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
    # Patron Ready clears stuck handshake when board empty
    assert (
        should_unlock_next_visit(
            visit_closed=True,
            takeout=True,
            throws_empty=True,
            saw_takeout_after_close=False,
            closed_by_scoring=False,
            patron_ready=True,
        )
        is True
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


def test_official_ad_takeout_finished_and_hand_fixtures() -> None:
    """Real Board/Detection states from Autodarts docs."""
    finished = _load("state_takeout_finished.json")
    assert finished["status"] == "Takeout finished"
    assert is_takeout_state(finished) is False
    assert extract_throws(finished) == []

    hand = _load("state_takeout_hand.json")
    assert hand["status"] == "Takeout started"
    assert hand["event"] == "Hand"
    assert is_takeout_state(hand) is True
    assert len(extract_throws(hand)) == 3
