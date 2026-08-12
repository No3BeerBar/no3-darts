"""
Property-style Board 1 poll fuzzer (no Autodarts hardware).

Generates random-ish Autodarts /api/state poll sequences around a 3-dart visit
with takeout blips, empty flickers, late dart 3, takeout-finished early,
double end-turn signals, Removing darts / Hand / Partial Takeout, mid-visit
clears, and patron Ready - then asserts seat-jump / auto-early-pull invariants.
"""

from __future__ import annotations

import random
from typing import Any, Optional

import pytest

from companion.visit_gate import scoring_frozen
from poll_replay import (
    assert_no_auto_end_turn_incomplete,
    assert_no_dart3_seat_jump,
    replay,
    seg,
    state,
)

FUZZ_SEED = 0xB0A9D1
FUZZ_CASES = 240

SEG_BANK = [
    ("T20", 20, 3),
    ("T19", 19, 3),
    ("5", 5, 1),
    ("1", 1, 1),
    ("D16", 16, 2),
    ("D8", 8, 2),
    ("S20", 20, 1),
    ("Bull", 25, 2),
]


def _prefix(n: int, rng: random.Random) -> list[dict]:
    a = seg(*SEG_BANK[rng.randrange(0, 3)])
    b = seg(*SEG_BANK[rng.randrange(2, 5)])
    c = seg(*SEG_BANK[rng.randrange(4, 8)])
    return [a, b, c][: max(1, min(3, n))]


def _noise_poll(rng: random.Random, throws: list[dict]) -> dict:
    kind = rng.choice(
        [
            "takeout_same",
            "takeout_empty",
            "takeout_finished_empty",
            "takeout_started",
            "removing_darts",
            "hand",
            "partial",
            "throw_empty",
            "throw_same",
            "event_takeout_status_throw",
        ]
    )
    if kind == "takeout_same":
        return state("Takeout", list(throws), event="Takeout")
    if kind == "takeout_empty":
        return state("Takeout", [], event="Takeout")
    if kind == "takeout_finished_empty":
        return state("Takeout finished", [], event="Takeout finished")
    if kind == "takeout_started":
        return state("Takeout started", list(throws), event="Takeout started")
    if kind == "removing_darts":
        return state(
            "Removing darts",
            list(throws) if rng.random() < 0.5 else [],
            event="Removing darts",
        )
    if kind == "hand":
        return state("Throw", list(throws) if rng.random() < 0.4 else [], event="Hand")
    if kind == "partial":
        return state("Throw", list(throws), event="Partial Takeout")
    if kind == "throw_empty":
        return state("Throw", [])
    if kind == "event_takeout_status_throw":
        return state("Throw", list(throws), event="Takeout")
    return state("Throw", list(throws))


def _build_sequence(
    rng: random.Random,
) -> tuple[str, list[dict], Optional[int]]:
    pattern = rng.choice(
        [
            "grow_with_noise",
            "premature_takeout_late3",
            "takeout_finished_early",
            "clear_mid_visit",
            "multi_empty_blip",
            "double_finished",
            "full_then_unlock_chaos",
            "patron_ready_early_pull",
            "removing_darts_late3",
            "residual_reshow_after_full",
        ]
    )
    visit = _prefix(3, rng)
    t1, t2, t3 = visit[:1], visit[:2], visit
    polls: list[dict] = []
    patron_ready_at: Optional[int] = None

    if pattern == "grow_with_noise":
        polls.append(state("Throw", t1))
        for _ in range(rng.randint(0, 3)):
            polls.append(_noise_poll(rng, t1))
        polls.append(state("Throw", t2))
        for _ in range(rng.randint(0, 5)):
            polls.append(_noise_poll(rng, t2))
        if rng.random() < 0.5:
            polls.append(state("Takeout", t3, event="Takeout"))
        else:
            polls.append(state("Throw", t3))
        for _ in range(rng.randint(0, 2)):
            polls.append(_noise_poll(rng, t3 if rng.random() < 0.5 else []))

    elif pattern == "premature_takeout_late3":
        polls = [
            state("Throw", t1),
            state("Throw", t2),
            state("Takeout", t2, event="Takeout"),
        ]
        for _ in range(rng.randint(0, 4)):
            polls.append(
                rng.choice(
                    [
                        state("Takeout", [], event="Takeout"),
                        state("Throw", []),
                        state("Takeout", t2, event="Takeout"),
                        state("Takeout finished", [], event="Takeout finished"),
                        state("Throw", t2, event="Hand"),
                    ]
                )
            )
        polls.append(state("Takeout", t3, event="Takeout"))

    elif pattern == "takeout_finished_early":
        polls = [
            state("Throw", t2),
            state("Takeout", t2, event="Takeout"),
            state("Takeout finished", [], event="Takeout finished"),
        ]
        for _ in range(rng.randint(0, 8)):
            polls.append(state("Throw", []))
        polls.append(state("Throw", t3))

    elif pattern == "clear_mid_visit":
        polls = [
            state("Throw", t1),
            state("Throw", t2),
            state("Throw", []),
        ]
        if rng.random() < 0.5:
            polls.append(state("Takeout", [], event="Takeout"))
        polls.append(state("Throw", t3))

    elif pattern == "multi_empty_blip":
        polls = [state("Throw", t2), state("Takeout", t2)]
        polls.extend(state("Throw", []) for _ in range(rng.randint(1, 20)))
        polls.append(state("Throw", t3))

    elif pattern == "double_finished":
        polls = [
            state("Throw", t2),
            state("Takeout", t2, event="Takeout"),
            state("Takeout finished", [], event="Takeout finished"),
            state("Takeout finished", [], event="Takeout finished"),
            state("Throw", []),
            state("Throw", t3),
        ]

    elif pattern == "full_then_unlock_chaos":
        polls = [
            state("Throw", t1),
            state("Throw", t2),
            state("Throw", t3),
            state("Takeout", t3, event="Takeout"),
            state("Takeout finished", [], event="Takeout finished"),
            state("Throw", []),
        ]
        for _ in range(rng.randint(0, 3)):
            polls.append(_noise_poll(rng, []))

    elif pattern == "patron_ready_early_pull":
        polls = [
            state("Throw", t2),
            state("Takeout", t2),
            state("Throw", []),
            state("Throw", []),
            state("Throw", [seg("T19", 19, 3)]),
        ]
        patron_ready_at = 2

    elif pattern == "removing_darts_late3":
        polls = [
            state("Throw", t2),
            state("Removing darts", t2, event="Removing darts"),
        ]
        for _ in range(rng.randint(0, 6)):
            polls.append(
                rng.choice(
                    [
                        state("Removing darts", [], event="Removing darts"),
                        state("Throw", []),
                        state("Takeout finished", [], event="Takeout finished"),
                        state("Throw", [], event="Hand"),
                    ]
                )
            )
        polls.append(state("Throw", t3))

    else:  # residual_reshow_after_full
        polls = [
            state("Throw", t1),
            state("Throw", t2),
            state("Throw", t3),
            state("Takeout", t3, event="Takeout"),
            state("Throw", []),
            state("Throw", t3 if rng.random() < 0.7 else t2),
        ]

    return pattern, polls, patron_ready_at


def _assert_invariants(
    pattern: str,
    polls: list[dict],
    events: list[dict[str, Any]],
    *,
    patron_ready_at: Optional[int],
) -> None:
    ctx = f"{pattern} polls={len(polls)} ready={patron_ready_at}"
    assert_no_dart3_seat_jump(events, context=ctx)
    if patron_ready_at is None:
        assert_no_auto_end_turn_incomplete(events, context=ctx)

    seat0_before_unlock = []
    for e in events:
        if e["type"] == "unlock":
            break
        if e["type"] == "dart" and int(e["seat"]) == 0:
            seat0_before_unlock.append(e)
    assert len(seat0_before_unlock) <= 3, (ctx, events)

    for d in events:
        if d["type"] != "dart" or int(d["seat"]) != 1:
            continue
        idx = events.index(d)
        prior_ok = any(
            e["type"] == "unlock"
            or (e["type"] == "turnEnded" and e["seat"] == 0)
            for e in events[:idx]
        )
        assert prior_ok, (ctx, d, events)

    assert scoring_frozen(takeout=True, visit_closed=False) is True


@pytest.mark.parametrize("case_i", range(FUZZ_CASES))
def test_fuzz_poll_sequences_never_seat_jump(case_i: int) -> None:
    rng = random.Random(FUZZ_SEED + case_i)
    pattern, polls, patron_ready_at = _build_sequence(rng)
    events = replay(polls, patron_ready_at=patron_ready_at)
    try:
        _assert_invariants(
            pattern, polls, events, patron_ready_at=patron_ready_at
        )
    except AssertionError as exc:
        raise AssertionError(
            f"case={case_i} seed={FUZZ_SEED + case_i} pattern={pattern}\n"
            f"patron_ready_at={patron_ready_at}\npolls={polls!r}\n"
            f"events={events!r}\n{exc}"
        ) from exc


def test_fuzz_corpus_covers_named_patterns() -> None:
    seen: set[str] = set()
    for i in range(FUZZ_CASES):
        rng = random.Random(FUZZ_SEED + i)
        pattern, _, _ = _build_sequence(rng)
        seen.add(pattern)
    assert seen == {
        "grow_with_noise",
        "premature_takeout_late3",
        "takeout_finished_early",
        "clear_mid_visit",
        "multi_empty_blip",
        "double_finished",
        "full_then_unlock_chaos",
        "patron_ready_early_pull",
        "removing_darts_late3",
        "residual_reshow_after_full",
    }
