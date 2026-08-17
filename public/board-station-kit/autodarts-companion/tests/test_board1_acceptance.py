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
    assert is_takeout_status("Reset")
    assert is_takeout_status("Board reset")
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
        should_end_turn_on_takeout(
            visit_closed=False, throws_count=1, no3_visit_done=True
        )
        is True
    )
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
    assert "takeout_hold_block" in src
    assert "takeout hold 409 (fail closed; retry after hold clears)" in src
    assert "retry after clear / TTL (no end-turn)" in src


def test_board1_keep_alive_starts_stopped_board_without_reset() -> None:
    """Idle-timer Stop must auto-start Board1; never reset/recal from keep-alive."""
    src = BRIDGE_PY.read_text(encoding="utf-8")
    assert "maybe_keep_alive" in src
    assert "Idle-timer / leftover Stop" in src
    assert "ensure_board_detecting" in src
    assert "after Board Manager restart" in src
    assert "try_start_detection" in src
    ka = (
        Path(__file__).resolve().parents[1] / "companion" / "keepalive.py"
    ).read_text(encoding="utf-8")
    assert "/api/detection/start" in ka
    assert "board_id" in ka
    assert "Never reset" in ka or "Never include reset" in ka
    assert "/api/reset" not in ka
    assert "/api/calibrate" not in ka
    assert "try_recalibrate" not in ka
    client = (
        Path(__file__).resolve().parents[1] / "companion" / "client.py"
    ).read_text(encoding="utf-8")
    assert "def try_start_detection" in client
    assert '("/api/detection/start", "/api/start")' in client
    health = (
        Path(__file__).resolve().parents[1] / "companion" / "health.py"
    ).read_text(encoding="utf-8")
    assert 'reason"] = "board_stopped"' in health
    assert 'reason") == "board_stopped"' in health


def test_board1_patron_reset_starts_board_clears_takeout_only() -> None:
    """Always-on Reset: start if Stopped; clear takeout; never end visit / recal."""
    src = BRIDGE_PY.read_text(encoding="utf-8")
    start = src.index("def handle_takeout_ready_ack")
    end = src.index("\n    def ", start + 1)
    ack = src[start:end]
    assert "try_start_detection" in ack
    assert "maybe_end_turn" not in ack
    assert "mark_visit_closed" not in ack
    assert "maybe_between_games_recal(" not in ack
    assert "Board reset between games" not in ack
    assert "try_recalibrate" in ack
    assert "stuck_takeout" in ack
    assert "is_takeout_status" in ack
    assert "already detecting, not in takeout" in ack
    assert "close_visit_if_no3_already_ended" in src
    assert "no3 already ended (bust)" in src
    assert "You are done - pull darts" in src
    assert "no3_visit_already_ended" in src


def test_board1_undo_correct_unfreezes_and_posts_frozen_banner() -> None:
    """Silent takeout after undo/correct: reopen No3 visit + arm Reset banner."""
    src = BRIDGE_PY.read_text(encoding="utf-8")
    assert "def reopen_visit_if_no3_undid" in src
    assert "reopen_visit_if_no3_undid()" in src
    assert "frozen_visit" in src
    assert "No3 undo/correct - scoring resumed" in src
    assert "silent hold was the Board 1 deadlock" in src
    assert "AD takeout this poll always wins" in src
    assert "Do not treat a reopened visit as" in src
