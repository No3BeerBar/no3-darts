"""
Board 1 / camera-bridge acceptance net (companion side) - John P0s.

  1. Recognize AD takeout / removing-darts; scoring frozen; Ready resets.
  2. A 3-dart AD visit can never apply dart 3 to the next No3 seat.
"""

from __future__ import annotations

from companion.mapping import is_takeout_status
from companion.visit_gate import (
    is_ad_visit_continuation,
    scoring_frozen,
    should_end_turn_on_empty_takeout_finished,
    should_end_turn_leaving_takeout_empty,
    should_end_turn_on_takeout,
    should_unlock_next_visit,
)


def _seg(name: str, number: int, mult: int) -> dict:
    return {"segment": {"name": name, "number": number, "multiplier": mult}}


def test_board1_p0_recognize_takeout_and_removing_darts() -> None:
    assert is_takeout_status("Takeout")
    assert is_takeout_status("Takeout started")
    assert is_takeout_status("Takeout finished")
    assert is_takeout_status("Removing darts")
    assert is_takeout_status("removing darts")
    assert scoring_frozen(takeout=True, visit_closed=False) is True
    assert scoring_frozen(takeout=False, visit_closed=True) is True


def test_board1_p0_patron_ready_can_unlock_sticky_takeout() -> None:
    """Reset control must clear freeze even if AD takeout string sticks."""
    assert (
        should_unlock_next_visit(
            visit_closed=True,
            takeout=True,
            throws_empty=True,
            patron_ready=True,
        )
        is True
    )
    # Without Ready / takeout handshake, scored-close alone must not unlock
    assert (
        should_unlock_next_visit(
            visit_closed=True,
            takeout=False,
            throws_empty=True,
            closed_by_scoring=True,
            saw_takeout_after_close=False,
        )
        is False
    )


def test_board1_p0_incomplete_never_auto_end_turn() -> None:
    """Dart 3 lag must not end-turn via empty / takeout-finished polls."""
    assert should_end_turn_on_takeout(visit_closed=False, throws_count=1) is False
    assert should_end_turn_on_takeout(visit_closed=False, throws_count=2) is False
    assert should_end_turn_on_takeout(visit_closed=False, throws_count=3) is True
    assert (
        should_end_turn_on_empty_takeout_finished(
            visit_closed=False,
            throws_empty=True,
            in_takeout=True,
            status="Takeout finished",
            empty_polls=50,
        )
        is False
    )
    assert (
        should_end_turn_leaving_takeout_empty(
            visit_closed=False,
            throws_empty=True,
            in_takeout=True,
            takeout=False,
            empty_polls=50,
        )
        is False
    )


def test_board1_p0_late_visit_reshow_is_continuation() -> None:
    closed = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    late = closed + [_seg("D16", 16, 2)]
    assert is_ad_visit_continuation(closed, late) is True
