"""Visit / takeout freeze gates (P1 dart must not land on P2)."""

from __future__ import annotations

import json
from pathlib import Path

from companion.client import extract_throws
from companion.visit_gate import (
    is_takeout_state,
    scoring_frozen,
    should_unlock_next_visit,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_fixture_takeout_keeps_throws() -> None:
    """Real AD signal: Takeout status while prior visit still in throws[]."""
    state = _load("state_three_darts.json")
    assert is_takeout_state(state) is True
    assert len(extract_throws(state)) == 3
    assert scoring_frozen(takeout=True, visit_closed=False) is True


def test_event_only_takeout_detected() -> None:
    # Some BM builds lag status; event still says Takeout
    assert is_takeout_state({"status": "Throw", "event": "Takeout"}) is True
    assert is_takeout_state({"status": "Throw detected", "event": "Dart"}) is False


def test_visit_closed_freezes_without_takeout_status() -> None:
    # Gap after No3 turnEnded before AD flips to Takeout
    assert scoring_frozen(takeout=False, visit_closed=True) is True
    assert scoring_frozen(takeout=False, visit_closed=False) is False


def test_unlock_only_when_empty_and_not_takeout() -> None:
    assert (
        should_unlock_next_visit(
            visit_closed=True, takeout=True, throws_empty=True
        )
        is False
    )
    assert (
        should_unlock_next_visit(
            visit_closed=True, takeout=False, throws_empty=False
        )
        is False
    )
    assert (
        should_unlock_next_visit(
            visit_closed=True, takeout=False, throws_empty=True
        )
        is True
    )
    assert (
        should_unlock_next_visit(
            visit_closed=False, takeout=False, throws_empty=True
        )
        is False
    )


def test_throw_fixture_not_takeout() -> None:
    state = _load("state_throw.json")
    assert is_takeout_state(state) is False
    assert extract_throws(state) == []
