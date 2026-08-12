"""
Shared Autodarts poll-replay harness for Board 1 seat-jump regressions.

Mirrors bridge poll ordering (no network): seat lock, takeout gates,
patron Ready / Reset, continuation refuse, end-turn -> next seat.
Used by hand-crafted scenarios and the property-style fuzzer.
"""

from __future__ import annotations

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


def seg(name: str, number: int, mult: int) -> dict:
    return {"segment": {"name": name, "number": number, "multiplier": mult}}


def state(status: str, throws: list[dict], event: str | None = None) -> dict:
    body: dict[str, Any] = {"status": status, "throws": throws}
    if event is not None:
        body["event"] = event
    return body


def replay(
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

    for poll_i, poll in enumerate(polls):
        throws = extract_throws(poll)
        status = str(poll.get("status") or "")
        takeout_now = is_takeout_state(poll)

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


def assert_no_dart3_seat_jump(
    events: list[dict[str, Any]], *, context: str = ""
) -> None:
    """Hard Board 1 invariant: dart 3 of a visit must never land on the next seat."""
    first_unlock = next(
        (i for i, e in enumerate(events) if e["type"] == "unlock"), None
    )
    for i, e in enumerate(events):
        if e["type"] != "dart" or int(e["seat"]) != 1:
            continue
        prior0 = sum(
            1
            for p in events[:i]
            if p["type"] == "dart" and int(p["seat"]) == 0
        )
        if first_unlock is not None and i > first_unlock:
            continue
        turn_ended = any(
            p["type"] == "turnEnded" and int(p["seat"]) == 0 for p in events[:i]
        )
        if prior0 < 3 and not turn_ended:
            refused = any(
                p["type"] in ("continuation-refuse", "dart-blocked")
                for p in events[: i + 1]
            )
            if not refused:
                raise AssertionError(
                    f"pre-unlock seat1 dart{(': ' + context) if context else ''}: "
                    f"prior0={prior0} events={events}"
                )


def assert_no_auto_end_turn_incomplete(
    events: list[dict[str, Any]], *, context: str = ""
) -> None:
    """Incomplete visits must not auto end-turn (patron Ready only)."""
    for i, e in enumerate(events):
        if e["type"] != "end-turn":
            continue
        if e.get("reason") == "takeout-ready ack":
            continue
        prior_darts = sum(
            1
            for p in events[:i]
            if p["type"] == "dart" and int(p["seat"]) == int(e["seat"])
        )
        if prior_darts < 3:
            raise AssertionError(
                f"auto end-turn incomplete{(': ' + context) if context else ''}: "
                f"reason={e.get('reason')} prior={prior_darts} events={events}"
            )
