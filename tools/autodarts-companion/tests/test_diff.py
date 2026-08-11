"""Tests for new-dart diffing (idempotent polling)."""

from __future__ import annotations

import json
from pathlib import Path

from companion.client import (
    extract_status,
    extract_throws,
    new_throws_since,
    throws_signature,
    visit_cleared,
)
from companion.mapping import dart_to_no3

FIX = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIX / name).read_text())


def _seg(name: str, number: int, mult: int) -> dict:
    return {"segment": {"name": name, "number": number, "multiplier": mult}}


def test_no_new_throws_when_unchanged() -> None:
    t = [_seg("T20", 20, 3)]
    assert new_throws_since(t, t) == []
    assert new_throws_since(t, list(t)) == []


def test_appends_only_new_darts() -> None:
    prev = [_seg("T20", 20, 3)]
    curr = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    fresh = new_throws_since(prev, curr)
    assert len(fresh) == 1
    assert dart_to_no3(fresh[0]) == ("single", 5)


def test_first_poll_posts_all() -> None:
    curr = [_seg("T20", 20, 3), _seg("5", 5, 1), _seg("D16", 16, 2)]
    fresh = new_throws_since([], curr)
    assert len(fresh) == 3
    assert [dart_to_no3(d) for d in fresh] == [
        ("triple", 20),
        ("single", 5),
        ("double", 16),
    ]


def test_same_signature_idempotent_across_polls() -> None:
    """Simulate three identical polls — only first batch is 'new'."""
    state = _load("state_three_darts.json")
    throws = extract_throws(state)
    seen: list[dict] = []
    posted: list[dict] = []
    for _ in range(3):
        fresh = new_throws_since(seen, throws)
        posted.extend(fresh)
        seen = list(throws)
    assert len(posted) == 3
    assert throws_signature(seen) == throws_signature(throws)
    assert [dart_to_no3(d) for d in posted] == [
        ("triple", 20),
        ("single", 5),
        ("double", 16),
    ]


def test_visit_cleared_on_takeout() -> None:
    prev = extract_throws(_load("state_three_darts.json"))
    curr = extract_throws(_load("state_throw.json"))
    assert visit_cleared(prev, curr)
    assert new_throws_since(prev, curr) == []


def test_diverged_list_not_treated_as_append() -> None:
    prev = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    # Correction of first dart — do not re-post as "new"
    curr = [_seg("T19", 19, 3), _seg("5", 5, 1)]
    assert new_throws_since(prev, curr) == []


def test_extract_nested_and_status() -> None:
    nested = _load("state_nested.json")
    throws = extract_throws(nested)
    assert len(throws) == 1
    assert dart_to_no3(throws[0]) == ("single", 11)
    assert extract_status(nested) == "Throw"


def test_extract_string_throws() -> None:
    state = _load("state_string_throws.json")
    throws = extract_throws(state)
    assert [dart_to_no3(t) for t in throws] == [
        ("triple", 19),
        ("double", 20),
        ("miss", 0),
    ]


def test_extract_status_takeout() -> None:
    assert extract_status(_load("state_three_darts.json")) == "Takeout"
    assert extract_status(_load("state_throw.json")) == "Throw"
