"""
Regression: replay Autodarts poll sequences for the Board 1 P0 seat jump.

John: 3 darts in one visit -> No3 scores 2 on current seat and puts dart 3 on
the next player. Root races (still after #38/#42):
  - Takeout finished + empty before late dart 3 -> end-turn -> unlock -> dart 3
    on next seat
  - Takeout blip + a few empty polls before late dart 3 -> same seat jump
  - No seat lock: camera dart/end-turn apply to whatever No3 seat is current

This test drives the same gate + diff + seat-lock decisions the bridge uses.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from companion.client import (
    VISIT_APPEND,
    VISIT_CLEARED,
    VISIT_REPLACE,
    VISIT_UNCHANGED,
    diff_visit,
    extract_throws,
)
from companion.mapping import is_takeout_finished_status
from companion.visit_gate import (
    INCOMPLETE_VISIT_MIN_EMPTY_POLLS,
    is_ad_visit_continuation,
    is_takeout_state,
    seat_matches_lock,
    should_clear_stale_takeout,
    should_end_turn_on_clear,
    should_end_turn_on_empty_takeout_finished,
    should_end_turn_leaving_takeout_empty,
    should_end_turn_on_takeout,
    should_unlock_next_visit,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _seg(name: str, number: int, mult: int) -> dict:
    return {"segment": {"name": name, "number": number, "multiplier": mult}}


def _state(status: str, throws: list[dict], event: str | None = None) -> dict:
    body: dict[str, Any] = {"status": status, "throws": throws}
    if event is not None:
        body["event"] = event
    return body


def _replay(
    polls: list[dict],
    *,
    patron_ready_at: Optional[int] = None,
) -> list[dict[str, Any]]:
    """
    Minimal mirror of bridge poll ordering (no network).

    Records dart appends and end-turn events with seat index 0 until end-turn,
    then seat 1 - matching No3 advancing on end-turn / turnEnded.

    Also mirrors visit seat lock + AD visit continuation refusal.
    patron_ready_at: poll index where patron taps Reset takeout.
    """
    prev_throws: list[dict] = []
    in_takeout = False
    visit_closed = False
    closed_by_scoring = False
    saw_takeout_after_close = False
    patron_force_ready = False
    empty_polls_in_takeout = 0
    locked_seat: Optional[int] = None
    closed_visit_throws: list[dict] = []
    seat = 0
    events: list[dict[str, Any]] = []

    def mark_closed(
        *,
        by_scoring: bool = False,
        throws_snapshot: list[dict] | None = None,
    ) -> None:
        nonlocal visit_closed, closed_by_scoring, saw_takeout_after_close
        nonlocal closed_visit_throws
        if by_scoring:
            closed_by_scoring = True
        if throws_snapshot is not None:
            closed_visit_throws = list(throws_snapshot)
        elif prev_throws and not closed_visit_throws:
            closed_visit_throws = list(prev_throws)
        if visit_closed:
            return
        visit_closed = True
        saw_takeout_after_close = False

    def end_turn(reason: str) -> None:
        nonlocal seat
        if visit_closed:
            mark_closed()
            return
        if locked_seat is not None and not seat_matches_lock(
            locked_seat=locked_seat, current_seat=seat
        ):
            events.append(
                {
                    "type": "end-turn-blocked",
                    "reason": reason,
                    "seat": seat,
                    "locked": locked_seat,
                }
            )
            mark_closed(throws_snapshot=list(prev_throws))
            return
        events.append({"type": "end-turn", "reason": reason, "seat": seat})
        seat = 1
        mark_closed()

    for poll_i, state in enumerate(polls):
        throws = extract_throws(state)
        status = str(state.get("status") or "")
        takeout_now = is_takeout_state(state)

        if in_takeout and not throws:
            empty_polls_in_takeout += 1
        else:
            empty_polls_in_takeout = 0

        if patron_ready_at is not None and poll_i == patron_ready_at:
            events.append({"type": "patron-ready", "seat": seat})
            end_turn("takeout-ready ack")
            mark_closed(throws_snapshot=list(prev_throws or throws))
            saw_takeout_after_close = True
            patron_force_ready = True

        diff = diff_visit(prev_throws, throws)
        kind = diff["kind"]
        retain_prev = False

        if (
            not visit_closed
            and throws
            and closed_visit_throws
            and is_ad_visit_continuation(closed_visit_throws, throws)
        ):
            events.append({"type": "continuation-refuse", "seat": seat})
            mark_closed(throws_snapshot=list(throws))
            saw_takeout_after_close = True

        if kind == VISIT_APPEND:
            if not visit_closed:
                if locked_seat is None:
                    locked_seat = seat
                closed_visit_throws = []
                for dart in diff["appended"]:
                    if not seat_matches_lock(
                        locked_seat=locked_seat, current_seat=seat
                    ):
                        events.append(
                            {
                                "type": "dart-blocked",
                                "seat": seat,
                                "locked": locked_seat,
                                "label": dart["segment"]["name"],
                            }
                        )
                        mark_closed(throws_snapshot=list(throws))
                        break
                    events.append(
                        {
                            "type": "dart",
                            "seat": seat,
                            "locked": locked_seat,
                            "label": dart["segment"]["name"],
                        }
                    )
                    darts_on_seat = sum(
                        1
                        for e in events
                        if e["type"] == "dart" and e["seat"] == seat
                    )
                    if darts_on_seat >= 3:
                        events.append({"type": "turnEnded", "seat": seat})
                        seat = 1
                        mark_closed(
                            by_scoring=True, throws_snapshot=list(throws)
                        )
                        break
        elif kind == VISIT_REPLACE:
            pass
        elif kind == VISIT_CLEARED:
            if should_end_turn_on_clear(
                takeout=takeout_now,
                in_takeout=in_takeout,
                visit_closed=visit_closed,
                prev_throw_count=len(prev_throws),
                takeout_finished=is_takeout_finished_status(status),
            ):
                end_turn("throws cleared")
            else:
                retain_prev = True
        elif kind == VISIT_UNCHANGED:
            pass

        if should_end_turn_on_empty_takeout_finished(
            visit_closed=visit_closed,
            throws_empty=not throws,
            in_takeout=in_takeout,
            status=status,
            empty_polls=empty_polls_in_takeout,
        ):
            end_turn("takeout finished empty")

        if takeout_now and not in_takeout:
            in_takeout = True
            if visit_closed:
                saw_takeout_after_close = True
            elif should_end_turn_on_takeout(
                visit_closed=visit_closed,
                throws_count=len(throws),
            ):
                end_turn(f"status={status}")
                if visit_closed:
                    saw_takeout_after_close = True
        elif takeout_now and in_takeout:
            if visit_closed:
                saw_takeout_after_close = True
            elif should_end_turn_on_takeout(
                visit_closed=visit_closed,
                throws_count=len(throws),
            ):
                end_turn(f"status={status}")
                if visit_closed:
                    saw_takeout_after_close = True
        elif should_end_turn_leaving_takeout_empty(
            visit_closed=visit_closed,
            throws_empty=not throws,
            in_takeout=in_takeout,
            takeout=takeout_now,
            empty_polls=empty_polls_in_takeout,
        ):
            end_turn("left takeout empty")
            if visit_closed:
                saw_takeout_after_close = True
            in_takeout = False
            empty_polls_in_takeout = 0
        elif should_clear_stale_takeout(
            takeout=takeout_now,
            in_takeout=in_takeout,
            visit_closed=visit_closed,
            throws_empty=not throws,
        ):
            in_takeout = False
            empty_polls_in_takeout = 0

        if should_unlock_next_visit(
            visit_closed=visit_closed,
            takeout=takeout_now,
            throws_empty=not throws,
            saw_takeout_after_close=saw_takeout_after_close,
            closed_by_scoring=closed_by_scoring,
            patron_ready=patron_force_ready,
        ):
            was_patron = patron_force_ready
            visit_closed = False
            closed_by_scoring = False
            saw_takeout_after_close = False
            patron_force_ready = False
            in_takeout = False
            empty_polls_in_takeout = 0
            locked_seat = None
            prev_throws = []
            if was_patron:
                closed_visit_throws = []
            events.append({"type": "unlock", "seat": seat})
            if not retain_prev:
                continue

        if not retain_prev:
            prev_throws = list(throws)

    return events


def test_three_throw_visit_takeout_same_poll_stays_on_seat0() -> None:
    """Classic fixture race: Takeout + 3 throws in one poll after 2 posted."""
    t1 = [_seg("T20", 20, 3)]
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    t3 = extract_throws(
        json.loads((FIXTURES / "state_three_darts.json").read_text(encoding="utf-8"))
    )
    events = _replay(
        [
            _state("Throw", t1),
            _state("Throw", t2),
            _state("Takeout", t3, event="Takeout"),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert len(darts) == 3
    assert all(d["seat"] == 0 for d in darts)
    first_advance = next(
        i
        for i, e in enumerate(events)
        if e["type"] in ("end-turn", "turnEnded")
    )
    dart3_i = next(
        i for i, e in enumerate(events) if e["type"] == "dart" and e["label"] == "D16"
    )
    assert dart3_i < first_advance


def test_premature_takeout_after_two_then_dart3_stays_on_seat0() -> None:
    """
    P0 race John hit: Takeout while only 2 throws visible, then dart 3.

    Old bridge ended turn on first Takeout -> seat 1 -> dart 3 on P2.
    """
    t1 = [_seg("T20", 20, 3)]
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    t3 = [
        _seg("T20", 20, 3),
        _seg("5", 5, 1),
        _seg("D16", 16, 2),
    ]
    events = _replay(
        [
            _state("Throw", t1),
            _state("Throw", t2),
            _state("Takeout", t2, event="Takeout"),  # premature
            _state("Takeout", [], event="Takeout"),  # empty flicker
            _state("Takeout", t3, event="Takeout"),  # dart 3 arrives
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts)
    end_turns = [e for e in events if e["type"] == "end-turn"]
    assert not any(
        e["type"] == "end-turn"
        and sum(
            1
            for d in events[: events.index(e)]
            if d["type"] == "dart" and d["seat"] == 0
        )
        < 3
        for e in end_turns
    )


def test_clear_flicker_between_dart2_and_dart3_no_seat_jump() -> None:
    t1 = [_seg("T20", 20, 3)]
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    t3 = [
        _seg("T20", 20, 3),
        _seg("5", 5, 1),
        _seg("1", 1, 1),
    ]
    events = _replay(
        [
            _state("Throw", t1),
            _state("Throw", t2),
            _state("Throw", []),  # mid-visit clear flicker
            _state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert len(darts) == 3
    assert all(d["seat"] == 0 for d in darts)
    assert not any(e["type"] == "end-turn" for e in events)


def test_takeout_blip_empty_then_throw_does_not_end_before_dart3() -> None:
    """Takeout blip + one empty + back to throw with dart 3 - still seat 0."""
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    t3 = [
        _seg("T20", 20, 3),
        _seg("5", 5, 1),
        _seg("D16", 16, 2),
    ]
    events = _replay(
        [
            _state("Throw", t2),
            _state("Takeout", t2),
            _state("Throw", []),  # left takeout, one empty poll - not enough
            _state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["seat"] for d in darts] == [0, 0, 0]
    assert darts[-1]["label"] == "D16"


def test_still_broken_takeout_finished_empty_then_late_dart3() -> None:
    """
    STILL-BROKEN after #42: Takeout finished + empty after 2 darts, then dart 3.

    Old gate treated takeout_finished as immediate early-pull end-turn, unlocked
    on the next empty Throw, then posted late dart 3 onto seat 1.
    """
    t1 = [_seg("T20", 20, 3)]
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    t3 = [
        _seg("T20", 20, 3),
        _seg("5", 5, 1),
        _seg("D16", 16, 2),
    ]
    events = _replay(
        [
            _state("Throw", t1),
            _state("Throw", t2),
            _state("Takeout", t2, event="Takeout"),
            _state("Takeout finished", [], event="Takeout finished"),
            _state("Throw", []),  # would unlock if we ended early
            _state("Throw", t3),  # late dart 3
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts), events
    assert not any(d["seat"] == 1 for d in darts)


def test_still_broken_multi_empty_after_takeout_blip_late_dart3() -> None:
    """
    Takeout blip + many empty polls before dart 3 must NOT end-turn.

    Auto early-pull used to fire after ~4 empties (~1.2s) and seat-jump.
    """
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    t3 = [
        _seg("T20", 20, 3),
        _seg("5", 5, 1),
        _seg("D16", 16, 2),
    ]
    empties = [_state("Throw", []) for _ in range(20)]
    events = _replay(
        [
            _state("Throw", t2),
            _state("Takeout", t2),
            *empties,
            _state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts), events
    assert not any(e["type"] == "end-turn" for e in events)


def test_lagging_dart3_after_long_takeout_empty_stays_on_seat0() -> None:
    """John P0: dart 3 lags every visit — never becomes seat 1 dart 1."""
    t1 = [_seg("T20", 20, 3)]
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    t3 = [
        _seg("T20", 20, 3),
        _seg("5", 5, 1),
        _seg("D16", 16, 2),
    ]
    events = _replay(
        [
            _state("Throw", t1),
            _state("Throw", t2),
            _state("Takeout", t2, event="Takeout"),
            _state("Takeout finished", [], event="Takeout finished"),
            *[_state("Throw", []) for _ in range(12)],
            _state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts), events
    assert not any(d["seat"] == 1 for d in darts)


def test_patron_ready_early_pull_allows_next_seat_first_dart() -> None:
    """Ready ends incomplete visit; next seat's first dart must still score."""
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    events = _replay(
        [
            _state("Throw", t2),
            _state("Takeout", t2),
            _state("Throw", []),  # patron ready
            _state("Throw", []),  # unlock
            _state("Throw", [_seg("T19", 19, 3)]),  # next seat dart 1
        ],
        patron_ready_at=2,
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "T19"]
    assert darts[-1]["seat"] == 1
    assert any(e["type"] == "patron-ready" for e in events)
    assert any(e["type"] == "unlock" for e in events)


def test_continuation_full_reshow_after_scored_close_refuses_wrong_seat() -> None:
    """
    After a scored 3-dart close + takeout unlock, AD re-showing the visit
    (late residual) must not post onto the next seat.
    """
    t1 = [_seg("T20", 20, 3)]
    t2 = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    t3 = [
        _seg("T20", 20, 3),
        _seg("5", 5, 1),
        _seg("D16", 16, 2),
    ]
    events = _replay(
        [
            _state("Throw", t1),
            _state("Throw", t2),
            _state("Throw", t3),  # turnEnded / scored close on seat 0
            _state("Takeout", t3, event="Takeout"),
            _state("Throw", []),  # unlock after takeout handshake + empty
            _state("Throw", t3),  # residual re-show — refuse
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts)
    assert any(e["type"] == "continuation-refuse" for e in events)


def test_visit_seat_lock_blocks_dart_on_advanced_seat() -> None:
    assert seat_matches_lock(locked_seat=0, current_seat=0) is True
    assert seat_matches_lock(locked_seat=0, current_seat=1) is False
    assert seat_matches_lock(locked_seat=None, current_seat=1) is True
    assert is_ad_visit_continuation(
        [_seg("T20", 20, 3), _seg("5", 5, 1)],
        [_seg("T20", 20, 3), _seg("5", 5, 1), _seg("D16", 16, 2)],
    )
