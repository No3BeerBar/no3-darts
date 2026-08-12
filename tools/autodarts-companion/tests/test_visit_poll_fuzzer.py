"""
Property-style Board 1 poll fuzzer (no Autodarts hardware).

Generates random-ish Autodarts /api/state poll sequences around a 3-dart visit
with takeout blips, empty flickers, late dart 3, takeout-finished early,
double end-turn signals, and mid-visit clears  -  then asserts seat-jump
invariants cannot slip through.
"""

from __future__ import annotations

import random
from typing import Any

import pytest

from companion.visit_gate import (
    INCOMPLETE_VISIT_MIN_EMPTY_POLLS,
    scoring_frozen,
)
from poll_replay import (
    assert_no_dart3_seat_jump,
    assert_visit_darts_same_seat,
    replay,
    seg,
    state,
)

# Deterministic seed so CI failures reproduce; bump intentionally when expanding.
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
    """Growing visit prefix of length n (1..3) from a fixed 3-dart visit."""
    a = seg(*SEG_BANK[rng.randrange(0, 3)])
    b = seg(*SEG_BANK[rng.randrange(2, 5)])
    c = seg(*SEG_BANK[rng.randrange(4, 8)])
    visit = [a, b, c]
    return visit[: max(1, min(3, n))]


def _noise_poll(rng: random.Random, throws: list[dict]) -> dict:
    """One disruptive poll: takeout blip, empty, finished, or clear flicker."""
    kind = rng.choice(
        [
            "takeout_same",
            "takeout_empty",
            "takeout_finished_empty",
            "takeout_started",
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
    if kind == "throw_empty":
        return state("Throw", [])
    if kind == "event_takeout_status_throw":
        return state("Throw", list(throws), event="Takeout")
    return state("Throw", list(throws))


def _build_sequence(rng: random.Random) -> tuple[str, list[dict], int | None]:
    """
    Build a poll sequence that grows a visit to 3 darts with chaos interleaved.

    Patterns cover the Board 1 races John hit, randomized.
    """
    pattern = rng.choice(
        [
            "grow_with_noise",
            "premature_takeout_late3",
            "takeout_finished_early",
            "clear_mid_visit",
            "multi_empty_blip",
            "double_finished",
            "full_then_unlock_chaos",
            "early_pull_then_continuation",
        ]
    )
    visit = _prefix(3, rng)
    t1, t2, t3 = visit[:1], visit[:2], visit

    polls: list[dict] = []

    patron_ready_at = None
    if pattern == "grow_with_noise":
        polls.append(state("Throw", t1))
        for _ in range(rng.randint(0, 3)):
            polls.append(_noise_poll(rng, t1))
        polls.append(state("Throw", t2))
        for _ in range(rng.randint(0, 4)):
            polls.append(_noise_poll(rng, t2))
        # Late dart 3  -  sometimes under Takeout
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
        for _ in range(rng.randint(0, 3)):
            polls.append(
                rng.choice(
                    [
                        state("Takeout", [], event="Takeout"),
                        state("Throw", []),
                        state("Takeout", t2, event="Takeout"),
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
        for _ in range(rng.randint(0, 2)):
            polls.append(state("Throw", []))
        polls.append(state("Throw", t3))

    elif pattern == "clear_mid_visit":
        polls = [
            state("Throw", t1),
            state("Throw", t2),
            state("Throw", []),
        ]
        if rng.random() < 0.4:
            polls.append(state("Takeout", [], event="Takeout"))
        polls.append(state("Throw", t3))

    elif pattern == "multi_empty_blip":
        polls = [state("Throw", t2), state("Takeout", t2)]
        n_empty = rng.randint(1, INCOMPLETE_VISIT_MIN_EMPTY_POLLS + 2)
        polls.extend(state("Throw", []) for _ in range(n_empty))
        # Auto early-pull is disabled - late dart 3 must still land on seat 0
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

    else:  # early_pull_then_continuation
        # Incomplete visit ends only via patron Ready (no auto empty early-pull).
        polls = [state("Throw", t2), state("Takeout", t2), state("Throw", [])]
        # After Ready+unlock, a brand-new next-seat dart is OK; a re-show of
        # the closed visit must refuse (handled when patron_ready_at set).
        polls.append(state("Throw", []))
        polls.append(state("Throw", [seg("T19", 19, 3)]))

    return pattern, polls, (2 if pattern == "early_pull_then_continuation" else None)


def _assert_invariants(pattern: str, polls: list[dict], events: list[dict[str, Any]]) -> None:
    ctx = f"{pattern} polls={len(polls)}"
    assert_no_dart3_seat_jump(events, context=ctx)
    assert_visit_darts_same_seat(events, context=ctx)

    darts = [e for e in events if e["type"] == "dart"]
    # Never post more than 3 darts on seat 0 for a single visit before unlock
    seat0_before_unlock = []
    for e in events:
        if e["type"] == "unlock":
            break
        if e["type"] == "dart" and int(e["seat"]) == 0:
            seat0_before_unlock.append(e)
    assert len(seat0_before_unlock) <= 3, (ctx, events)

    # If D16 (or third label) appears as a dart, it must be seat 0 unless
    # a prior turnEnded/unlock already advanced legitimately after 3 darts.
    labels0 = [d["label"] for d in darts if d["seat"] == 0]
    for d in darts:
        if d["seat"] != 1:
            continue
        # seat1 dart is only OK after unlock or after turnEnded with 3 on seat0
        idx = events.index(d)
        prior_ok = any(
            e["type"] == "unlock"
            or (e["type"] == "turnEnded" and e["seat"] == 0)
            for e in events[:idx]
        )
        assert prior_ok, (ctx, d, events)

    # Takeout freeze helper still holds (unit invariant used by bridge)
    assert scoring_frozen(takeout=True, visit_closed=False) is True

    # Classic bleed: seat0 posted only 2 darts, then seat1 scores without a
    # legitimate advance (unlock / turnEnded / patron-ready end-turn).
    if len(labels0) == 2:
        for d in darts:
            if d["seat"] != 1:
                continue
            idx = events.index(d)
            advanced = any(
                e["type"] in ("unlock", "turnEnded", "end-turn", "patron-ready")
                for e in events[:idx]
            )
            refused = any(
                e["type"] in ("continuation-refuse", "dart-blocked")
                for e in events[: idx + 1]
            )
            assert advanced or refused, (ctx, d, events)


@pytest.mark.parametrize("case_i", range(FUZZ_CASES))
def test_fuzz_poll_sequences_never_seat_jump(case_i: int) -> None:
    rng = random.Random(FUZZ_SEED + case_i)
    pattern, polls, patron_ready_at = _build_sequence(rng)
    events = replay(polls, patron_ready_at=patron_ready_at)
    try:
        _assert_invariants(pattern, polls, events)
    except AssertionError as exc:
        raise AssertionError(
            f"case={case_i} seed={FUZZ_SEED + case_i} pattern={pattern}\n"
            f"polls={polls!r}\nevents={events!r}\n{exc}"
        ) from exc


def test_fuzz_corpus_covers_named_patterns() -> None:
    """Sanity: generator hits every named pattern within the fixed seed space."""
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
        "early_pull_then_continuation",
    }


def test_scoring_frozen_during_takeout_and_closed_visit() -> None:
    """Ready/reset path depends on freeze until clean board / ack."""
    assert scoring_frozen(takeout=True, visit_closed=False)
    assert scoring_frozen(takeout=False, visit_closed=True)
    assert not scoring_frozen(takeout=False, visit_closed=False)
