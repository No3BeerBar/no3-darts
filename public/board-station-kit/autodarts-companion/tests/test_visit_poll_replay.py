"""
Regression: replay Autodarts poll sequences for the Board 1 P0 seat jump.

John: 3 darts in one visit -> No3 scores 2 on current seat and puts dart 3 on
the next player. Root race: Takeout / clear before dart 3 is mirrored, then
empty-board unlock lets dart 3 POST onto the next seat.

This test drives the same gate + diff decisions the bridge uses (APPEND before
takeout/end-turn; defer end-turn until 3 throws or confirmed early pull) and
asserts end-turn never fires before dart 3 is appended.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

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
    is_takeout_state,
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


def _replay(polls: list[dict]) -> list[dict[str, Any]]:
    """
    Minimal mirror of bridge poll ordering (no network).

    Records dart appends and end-turn events with seat index 0 until end-turn,
    then seat 1 - matching No3 advancing on end-turn / turnEnded.
    """
    prev_throws: list[dict] = []
    in_takeout = False
    visit_closed = False
    closed_by_scoring = False
    saw_takeout_after_close = False
    empty_polls_in_takeout = 0
    seat = 0
    events: list[dict[str, Any]] = []

    def mark_closed(*, by_scoring: bool = False) -> None:
        nonlocal visit_closed, closed_by_scoring, saw_takeout_after_close
        if by_scoring:
            closed_by_scoring = True
        if visit_closed:
            return
        visit_closed = True
        saw_takeout_after_close = False

    def end_turn(reason: str) -> None:
        nonlocal seat
        if visit_closed:
            mark_closed()
            return
        events.append({"type": "end-turn", "reason": reason, "seat": seat})
        seat = 1
        mark_closed()

    for state in polls:
        throws = extract_throws(state)
        status = str(state.get("status") or "")
        takeout_now = is_takeout_state(state)

        if in_takeout and not throws:
            empty_polls_in_takeout += 1
        else:
            empty_polls_in_takeout = 0

        diff = diff_visit(prev_throws, throws)
        kind = diff["kind"]
        retain_prev = False

        if kind == VISIT_APPEND:
            if not visit_closed:
                for dart in diff["appended"]:
                    events.append(
                        {
                            "type": "dart",
                            "seat": seat,
                            "label": dart["segment"]["name"],
                        }
                    )
                    # Simulate No3 auto end after 3rd dart on seat
                    darts_on_seat = sum(
                        1
                        for e in events
                        if e["type"] == "dart" and e["seat"] == seat
                    )
                    if darts_on_seat >= 3:
                        events.append(
                            {
                                "type": "turnEnded",
                                "seat": seat,
                            }
                        )
                        seat = 1
                        mark_closed(by_scoring=True)
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
        ):
            visit_closed = False
            closed_by_scoring = False
            saw_takeout_after_close = False
            in_takeout = False
            empty_polls_in_takeout = 0
            prev_throws = []
            events.append({"type": "unlock", "seat": seat})
            if not retain_prev:
                # unlock clears prev; skip retain
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
    # Seat must not advance before the third dart event
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
    # end-turn only after full visit (or via turnEnded); never with only 2 darts
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
