"""
Board 1 adversarial poll-replay sandbox (no Autodarts hardware).

John: after takeout-reset + dart3 fail-closed land, fuzz ourselves with the
races that seat-jumped on the bar:

  1. takeout blip
  2. late dart 3
  3. empty flicker
  4. takeout-finished-at-2
  5. double clear

Each named sequence must keep dart 1-3 on seat 0 (or refuse continuation)
and never auto end-turn an incomplete visit.
"""

from __future__ import annotations

from typing import Any, Callable

import pytest

from poll_replay import (
    assert_no_auto_end_turn_incomplete,
    assert_no_dart3_seat_jump,
    replay,
    seg,
    state,
)

T1 = [seg("T20", 20, 3)]
T2 = [seg("T20", 20, 3), seg("5", 5, 1)]
T3 = [seg("T20", 20, 3), seg("5", 5, 1), seg("D16", 16, 2)]


def _assert_seat0_full_visit(events: list[dict[str, Any]]) -> None:
    darts = [e for e in events if e["type"] == "dart"]
    assert [d["label"] for d in darts] == ["T20", "5", "D16"], events
    assert all(d["seat"] == 0 for d in darts), events
    assert not any(d["seat"] == 1 for d in darts), events
    assert_no_dart3_seat_jump(events)
    assert_no_auto_end_turn_incomplete(events)


def seq_takeout_blip() -> list[dict]:
    """Takeout appears briefly at 2 darts, then back to Throw before dart 3."""
    return [
        state("Throw", T1),
        state("Throw", T2),
        state("Takeout", T2, event="Takeout"),
        state("Throw", T2),  # blip ends; still incomplete
        state("Throw", T3),
    ]


def seq_late_dart3() -> list[dict]:
    """Classic lag: takeout + empties, then dart 3 finally appears."""
    return [
        state("Throw", T1),
        state("Throw", T2),
        state("Takeout", T2, event="Takeout"),
        state("Takeout", [], event="Takeout"),
        *[state("Throw", []) for _ in range(8)],
        state("Throw", T3),
    ]


def seq_empty_flicker() -> list[dict]:
    """Mid-visit empty poll(s) between dart 2 and dart 3 (no takeout)."""
    return [
        state("Throw", T1),
        state("Throw", T2),
        state("Throw", []),
        state("Throw", []),
        state("Throw", T3),
    ]


def seq_takeout_finished_at_2() -> list[dict]:
    """Takeout finished while only 2 throws visible - must not end-turn."""
    return [
        state("Throw", T1),
        state("Throw", T2),
        state("Takeout", T2, event="Takeout"),
        state("Takeout finished", [], event="Takeout finished"),
        state("Throw", []),
        state("Throw", T3),
    ]


def seq_double_clear() -> list[dict]:
    """Two CLEARED flickers mid-visit before dart 3 returns."""
    return [
        state("Throw", T1),
        state("Throw", T2),
        state("Throw", []),  # clear 1
        state("Throw", T2),  # reappear incomplete
        state("Throw", []),  # clear 2
        state("Throw", T3),
    ]


def seq_compound_kitchen_sink() -> list[dict]:
    """Stack blip + finished-at-2 + empty flicker + double clear + late dart 3."""
    return [
        state("Throw", T1),
        state("Throw", T2),
        state("Takeout", T2, event="Takeout"),  # blip
        state("Throw", T2),
        state("Takeout", T2, event="Takeout"),
        state("Takeout finished", [], event="Takeout finished"),  # finished-at-2
        state("Throw", []),  # empty flicker
        state("Throw", T2),
        state("Throw", []),  # clear 1
        state("Throw", []),  # clear 2 (sustained empty)
        state("Removing darts", [], event="Removing darts"),
        state("Throw", T3),  # late dart 3
    ]


def seq_double_clear_during_takeout() -> list[dict]:
    """Clear / reappear / clear while AD status sticks on Takeout."""
    return [
        state("Throw", T2),
        state("Takeout", T2, event="Takeout"),
        state("Takeout", [], event="Takeout"),
        state("Takeout", T2, event="Takeout"),
        state("Takeout", [], event="Takeout"),
        state("Takeout", T3, event="Takeout"),
    ]


def seq_double_finished_then_late3() -> list[dict]:
    """Takeout finished twice (double end-turn signal) then late dart 3."""
    return [
        state("Throw", T2),
        state("Takeout", T2, event="Takeout"),
        state("Takeout finished", [], event="Takeout finished"),
        state("Takeout finished", [], event="Takeout finished"),
        state("Throw", []),
        state("Throw", []),
        state("Throw", T3),
    ]


ADVERSARIAL: dict[str, Callable[[], list[dict]]] = {
    "takeout_blip": seq_takeout_blip,
    "late_dart3": seq_late_dart3,
    "empty_flicker": seq_empty_flicker,
    "takeout_finished_at_2": seq_takeout_finished_at_2,
    "double_clear": seq_double_clear,
    "compound_kitchen_sink": seq_compound_kitchen_sink,
    "double_clear_during_takeout": seq_double_clear_during_takeout,
    "double_finished_then_late3": seq_double_finished_then_late3,
}


@pytest.mark.parametrize("name", list(ADVERSARIAL.keys()))
def test_adversarial_poll_sequence(name: str) -> None:
    polls = ADVERSARIAL[name]()
    events = replay(polls)
    try:
        _assert_seat0_full_visit(events)
    except AssertionError as exc:
        raise AssertionError(
            f"adversarial={name}\npolls={polls!r}\nevents={events!r}\n{exc}"
        ) from exc


def test_adversarial_corpus_names_john_requested() -> None:
    """Sandbox must include the five named races John called out."""
    required = {
        "takeout_blip",
        "late_dart3",
        "empty_flicker",
        "takeout_finished_at_2",
        "double_clear",
    }
    assert required.issubset(ADVERSARIAL.keys())


def test_adversarial_no_unlock_before_full_visit() -> None:
    """None of the incomplete races may unlock next seat before dart 3."""
    for name, builder in ADVERSARIAL.items():
        events = replay(builder())
        unlock_i = next(
            (i for i, e in enumerate(events) if e["type"] == "unlock"), None
        )
        if unlock_i is None:
            continue
        prior0 = sum(
            1
            for e in events[:unlock_i]
            if e["type"] == "dart" and int(e["seat"]) == 0
        )
        assert prior0 >= 3, (name, events)
