"""
Regression: replay Autodarts poll sequences for the Board 1 P0 seat jump.

John: 3 darts in one visit -> No3 scores 2 on current seat and puts dart 3 on
the next player. Root races (still after #38/#42/#48/#49):
  - Takeout finished + empty before late dart 3 -> end-turn -> unlock -> dart 3
    on next seat
  - Takeout blip + a few empty polls before late dart 3 -> same seat jump
  - No seat lock: camera dart/end-turn apply to whatever No3 seat is current

This test drives the same gate + diff + seat-lock decisions the bridge uses.
"""

from __future__ import annotations

import json
from pathlib import Path

from companion.client import extract_throws
from companion.visit_gate import is_ad_visit_continuation, seat_matches_lock
from poll_replay import (
    assert_no_auto_end_turn_incomplete,
    assert_no_dart3_seat_jump,
    replay,
    seg,
    state,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_three_throw_visit_takeout_same_poll_stays_on_seat0() -> None:
    """Classic fixture race: Takeout + 3 throws in one poll after 2 posted."""
    t1 = [seg("T20", 20, 3)]
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = extract_throws(
        json.loads((FIXTURES / "state_three_darts.json").read_text(encoding="utf-8"))
    )
    events = replay(
        [
            state("Throw", t1),
            state("Throw", t2),
            state("Takeout", t3, event="Takeout"),
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
    assert_no_dart3_seat_jump(events)


def test_premature_takeout_after_two_then_dart3_stays_on_seat0() -> None:
    """
    P0 race John hit: Takeout while only 2 throws visible, then dart 3.

    Old bridge ended turn on first Takeout -> seat 1 -> dart 3 on P2.
    """
    t1 = [seg("T20", 20, 3)]
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [
        seg("T20", 20, 3),
        seg("5", 5, 1),
        seg("D16", 16, 2),
    ]
    events = replay(
        [
            state("Throw", t1),
            state("Throw", t2),
            state("Takeout", t2, event="Takeout"),  # premature
            state("Takeout", [], event="Takeout"),  # empty flicker
            state("Takeout", t3, event="Takeout"),  # dart 3 arrives
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
    assert_no_dart3_seat_jump(events)


def test_clear_flicker_between_dart2_and_dart3_no_seat_jump() -> None:
    t1 = [seg("T20", 20, 3)]
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [
        seg("T20", 20, 3),
        seg("5", 5, 1),
        seg("1", 1, 1),
    ]
    events = replay(
        [
            state("Throw", t1),
            state("Throw", t2),
            state("Throw", []),  # mid-visit clear flicker
            state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert len(darts) == 3
    assert all(d["seat"] == 0 for d in darts)
    assert not any(e["type"] == "end-turn" for e in events)
    assert_no_dart3_seat_jump(events)


def test_takeout_blip_empty_then_throw_does_not_end_before_dart3() -> None:
    """Takeout blip + one empty + back to throw with dart 3 - still seat 0."""
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [
        seg("T20", 20, 3),
        seg("5", 5, 1),
        seg("D16", 16, 2),
    ]
    events = replay(
        [
            state("Throw", t2),
            state("Takeout", t2),
            state("Throw", []),  # left takeout, one empty poll - not enough
            state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["seat"] for d in darts] == [0, 0, 0]
    assert darts[-1]["label"] == "D16"
    assert_no_dart3_seat_jump(events)


def test_still_broken_takeout_finished_empty_then_late_dart3() -> None:
    """
    STILL-BROKEN after #42: Takeout finished + empty after 2 darts, then dart 3.

    Old gate treated takeout_finished as immediate early-pull end-turn, unlocked
    on the next empty Throw, then posted late dart 3 onto seat 1.
    """
    t1 = [seg("T20", 20, 3)]
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [
        seg("T20", 20, 3),
        seg("5", 5, 1),
        seg("D16", 16, 2),
    ]
    events = replay(
        [
            state("Throw", t1),
            state("Throw", t2),
            state("Takeout", t2, event="Takeout"),
            state("Takeout finished", [], event="Takeout finished"),
            state("Throw", []),  # would unlock if we ended early
            state("Throw", t3),  # late dart 3
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts), events
    assert not any(d["seat"] == 1 for d in darts)
    assert_no_dart3_seat_jump(events)


def test_still_broken_multi_empty_after_takeout_blip_late_dart3() -> None:
    """
    Takeout blip + many empty polls before dart 3 must NOT end-turn.

    Auto early-pull used to fire after ~4 empties (~1.2s) and seat-jump.
    """
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [
        seg("T20", 20, 3),
        seg("5", 5, 1),
        seg("D16", 16, 2),
    ]
    empties = [state("Throw", []) for _ in range(20)]
    events = replay(
        [
            state("Throw", t2),
            state("Takeout", t2),
            *empties,
            state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts), events
    assert not any(e["type"] == "end-turn" for e in events)
    assert_no_dart3_seat_jump(events)


def test_lagging_dart3_after_long_takeout_empty_stays_on_seat0() -> None:
    """John P0: dart 3 lags every visit - never becomes seat 1 dart 1."""
    t1 = [seg("T20", 20, 3)]
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [
        seg("T20", 20, 3),
        seg("5", 5, 1),
        seg("D16", 16, 2),
    ]
    events = replay(
        [
            state("Throw", t1),
            state("Throw", t2),
            state("Takeout", t2, event="Takeout"),
            state("Takeout finished", [], event="Takeout finished"),
            *[state("Throw", []) for _ in range(12)],
            state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts), events
    assert not any(d["seat"] == 1 for d in darts)
    assert_no_dart3_seat_jump(events)


def test_patron_ready_early_pull_allows_next_seat_first_dart() -> None:
    """Ready ends incomplete visit; next seat's first dart must still score."""
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    events = replay(
        [
            state("Throw", t2),
            state("Takeout", t2),
            state("Throw", []),  # patron ready
            state("Throw", []),  # unlock
            state("Throw", [seg("T19", 19, 3)]),  # next seat dart 1
        ],
        patron_ready_at=2,
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "T19"]
    assert darts[-1]["seat"] == 1
    assert any(e["type"] == "patron-ready" for e in events)
    assert any(e["type"] == "unlock" for e in events)
    assert_no_dart3_seat_jump(events)


def test_continuation_full_reshow_after_scored_close_refuses_wrong_seat() -> None:
    """
    After a scored 3-dart close + takeout unlock, AD re-showing the visit
    (late residual) must not post onto the next seat.
    """
    t1 = [seg("T20", 20, 3)]
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [
        seg("T20", 20, 3),
        seg("5", 5, 1),
        seg("D16", 16, 2),
    ]
    events = replay(
        [
            state("Throw", t1),
            state("Throw", t2),
            state("Throw", t3),  # turnEnded / scored close on seat 0
            state("Takeout", t3, event="Takeout"),
            state("Throw", []),  # unlock after takeout handshake + empty
            state("Throw", t3),  # residual re-show - refuse
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts)
    assert any(e["type"] == "continuation-refuse" for e in events)
    assert_no_dart3_seat_jump(events)


def _visit_polls(darts: list[dict]) -> list[dict]:
    """One 3-dart visit + takeout + empty unlock (Board 1 handshake)."""
    polls: list[dict] = []
    acc: list[dict] = []
    for d in darts:
        acc = [*acc, d]
        polls.append(state("Throw", list(acc)))
    polls.append(state("Takeout", list(acc), event="Takeout"))
    polls.append(state("Throw", []))
    return polls


def test_forty_one_same_target_next_seat_scores_after_round_3() -> None:
    """
    41 round 3 is ANY DOUBLE - both players throw the same target.

    Old continuation gate treated P2's first dart matching P1's first/last
    segment as residual dart 3, froze visit_closed, and left the turn stuck
    on P2 with no scoring. Must keep advancing through round 3+ .
    """
    round_20 = [seg("T20", 20, 3), seg("20", 20, 1), seg("D20", 20, 2)]
    round_19 = [seg("T19", 19, 3), seg("19", 19, 1), seg("D19", 19, 2)]
    # Any double - identical visits are realistic (both go D20)
    any_double = [seg("D20", 20, 2), seg("D16", 16, 2), seg("D8", 8, 2)]
    round_18 = [seg("T18", 18, 3), seg("18", 18, 1), seg("D18", 18, 2)]

    polls: list[dict] = []
    for visit in (round_20, round_19, any_double, round_18):
        polls.extend(_visit_polls(visit))  # P1
        polls.extend(_visit_polls(visit))  # P2 same segments

    events = replay(polls)
    darts = [e for e in events if e["type"] == "dart"]
    assert not any(e["type"] == "continuation-refuse" for e in events), events
    # 4 rounds x 2 players x 3 darts
    assert len(darts) == 24, [d["label"] for d in darts]
    seats = [d["seat"] for d in darts]
    expected = ([0, 0, 0, 1, 1, 1] * 4)
    assert seats == expected, seats
    assert_no_dart3_seat_jump(events)
    assert_no_auto_end_turn_incomplete(events)


def test_same_segment_first_dart_after_unlock_is_new_visit() -> None:
    """Minimal repro: P1 T20/5/D16, unlock, P2 also starts T20 (41 20s)."""
    t3 = [seg("T20", 20, 3), seg("5", 5, 1), seg("D16", 16, 2)]
    events = replay(
        [
            state("Throw", t3[:1]),
            state("Throw", t3[:2]),
            state("Throw", t3),
            state("Takeout", t3, event="Takeout"),
            state("Throw", []),
            state("Throw", [seg("T20", 20, 3)]),  # P2 same first dart
            state("Throw", [seg("T20", 20, 3), seg("D20", 20, 2)]),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert not any(e["type"] == "continuation-refuse" for e in events), events
    assert [d["seat"] for d in darts] == [0, 0, 0, 1, 1]
    assert darts[3]["label"] == "T20"
    assert_no_dart3_seat_jump(events)


def test_visit_seat_lock_blocks_dart_on_advanced_seat() -> None:
    assert seat_matches_lock(locked_seat=0, current_seat=0) is True
    assert seat_matches_lock(locked_seat=0, current_seat=1) is False
    assert seat_matches_lock(locked_seat=None, current_seat=1) is True
    assert is_ad_visit_continuation(
        [seg("T20", 20, 3), seg("5", 5, 1)],
        [seg("T20", 20, 3), seg("5", 5, 1), seg("D16", 16, 2)],
    )

def test_double_end_turn_signals_do_not_seat_jump_late_dart3() -> None:
    """Takeout finished twice + empty flickers must not put late dart 3 on seat 1."""
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [seg("T20", 20, 3), seg("5", 5, 1), seg("D16", 16, 2)]
    events = replay(
        [
            state("Throw", t2),
            state("Takeout", t2, event="Takeout"),
            state("Takeout finished", [], event="Takeout finished"),
            state("Takeout finished", [], event="Takeout finished"),
            state("Throw", []),
            state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert all(d["seat"] == 0 for d in darts)
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert_no_dart3_seat_jump(events)
    assert_no_auto_end_turn_incomplete(events)


def test_removing_darts_status_same_as_takeout_for_late_dart3() -> None:
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [seg("T20", 20, 3), seg("5", 5, 1), seg("D16", 16, 2)]
    events = replay(
        [
            state("Throw", t2),
            state("Removing darts", t2, event="Removing darts"),
            state("Removing darts", [], event="Removing darts"),
            state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts)
    assert_no_dart3_seat_jump(events)


def test_hand_partial_takeout_event_keeps_late_dart3_on_seat0() -> None:
    t2 = [seg("T20", 20, 3), seg("5", 5, 1)]
    t3 = [seg("T20", 20, 3), seg("5", 5, 1), seg("D16", 16, 2)]
    events = replay(
        [
            state("Throw", t2),
            state("Throw", t2, event="Partial Takeout"),
            state("Throw", [], event="Hand"),
            state("Throw", t3),
        ]
    )
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"]
    assert all(d["seat"] == 0 for d in darts)
    assert_no_dart3_seat_jump(events)
    assert_no_auto_end_turn_incomplete(events)
