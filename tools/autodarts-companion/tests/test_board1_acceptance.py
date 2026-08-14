"""
Board 1 / camera-bridge acceptance net (companion side) - John P0s.

  1. Recognize AD takeout / removing-darts; scoring frozen; Ready resets.
  2. A 3-dart AD visit can never apply dart 3 to the next No3 seat.
"""

from __future__ import annotations

from pathlib import Path

from companion.mapping import is_takeout_status
from companion.visit_gate import (
    is_ad_visit_continuation,
    scoring_frozen,
    should_end_turn_on_empty_takeout_finished,
    should_end_turn_leaving_takeout_empty,
    should_end_turn_on_takeout,
    should_unlock_next_visit,
)

BRIDGE_PY = Path(__file__).resolve().parents[1] / "companion" / "bridge.py"


def _seg(name: str, number: int, mult: int) -> dict:
    return {"segment": {"name": name, "number": number, "multiplier": mult}}


def test_board1_p0_recognize_takeout_and_removing_darts() -> None:
    assert is_takeout_status("Takeout")
    assert is_takeout_status("Takeout started")
    assert is_takeout_status("Hand")
    assert is_takeout_status("Partial Takeout")
    assert is_takeout_status("Removing darts")
    assert is_takeout_status("removing darts")
    # Takeout finished = complete (must not leave Pull-darts stuck)
    assert not is_takeout_status("Takeout finished")
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


def test_board1_p0_forty_one_same_target_is_not_continuation() -> None:
    """P2 hitting the same 41 target as P1 must not freeze after unlock."""
    done = [_seg("D20", 20, 2), _seg("D16", 16, 2), _seg("D8", 8, 2)]
    assert is_ad_visit_continuation(done, [_seg("D20", 20, 2)]) is False
    assert is_ad_visit_continuation(done, [_seg("D8", 8, 2)]) is False


def test_board1_p0_maybe_end_turn_fail_closed_without_seat() -> None:
    """Never POST end-turn without expectedPlayerIndex when seat is unknown."""
    src = BRIDGE_PY.read_text(encoding="utf-8")
    assert "def maybe_end_turn" in src
    assert "No3 seat unknown (fail closed" in src
    assert '"expectedPlayerIndex": seat' in src
    # Must not omit the field when seat is missing (old skip-check path)
    assert "if seat is not None:\n            payload[\"expectedPlayerIndex\"]" not in src
    assert "patron_force_ready" in src
    assert "keeping banner cleared until unlock" in src


def test_board1_keep_alive_starts_stopped_board_without_reset() -> None:
    """Idle-timer Stop must auto-start Board1; never reset/recal from keep-alive."""
    src = BRIDGE_PY.read_text(encoding="utf-8")
    assert "maybe_keep_alive" in src
    assert "Idle-timer / leftover Stop" in src
    ka = (
        Path(__file__).resolve().parents[1] / "companion" / "keepalive.py"
    ).read_text(encoding="utf-8")
    assert "/api/detection/start" in ka
    assert "board_id" in ka
    assert "Never reset" in ka or "Never include reset" in ka
    assert "/api/reset" not in ka
    assert "/api/calibrate" not in ka
    assert "try_recalibrate" not in ka
