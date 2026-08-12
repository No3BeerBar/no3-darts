"""Fixture-based tests for Autodarts segment -> No3 mapping."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from companion.mapping import (
    dart_to_no3,
    is_takeout_finished_status,
    is_takeout_status,
    label_to_kind_number,
)

FIX = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIX / name).read_text())


@pytest.mark.parametrize(
    "label,kind,number",
    [
        ("S1", "single", 1),
        ("S20", "single", 20),
        ("1", "single", 1),
        ("20", "single", 20),
        ("D1", "double", 1),
        ("D20", "double", 20),
        ("T1", "triple", 1),
        ("T20", "triple", 20),
        ("25", "outer_bull", 25),
        ("SBULL", "outer_bull", 25),
        ("OUTER_BULL", "outer_bull", 25),
        ("Bull", "bull", 50),
        ("BULL", "bull", 50),
        ("50", "bull", 50),
        ("D25", "bull", 50),
        ("Miss", "miss", 0),
        ("MISS", "miss", 0),
        ("0", "miss", 0),
        ("M", "miss", 0),
        ("M20", "miss", 0),
    ],
)
def test_label_to_kind_number(label: str, kind: str, number: int) -> None:
    assert label_to_kind_number(label) == (kind, number)


@pytest.mark.parametrize(
    "segment,kind,number",
    [
        ({"number": 20, "multiplier": 1, "name": "20"}, "single", 20),
        ({"number": 20, "multiplier": 2, "name": "D20"}, "double", 20),
        ({"number": 20, "multiplier": 3, "name": "T20"}, "triple", 20),
        ({"number": 25, "multiplier": 1, "name": "25"}, "outer_bull", 25),
        ({"number": 25, "multiplier": 2, "name": "Bull"}, "bull", 50),
        ({"number": 0, "multiplier": 0, "name": "Miss"}, "miss", 0),
        ({"number": 5, "multiplier": 0, "name": "M5"}, "miss", 0),
        # number/multiplier win over a weird name
        ({"number": 19, "multiplier": 3, "name": "???"}, "triple", 19),
    ],
)
def test_dart_to_no3_from_segment(segment: dict, kind: str, number: int) -> None:
    assert dart_to_no3({"segment": segment}) == (kind, number)


def test_all_singles_doubles_triples_1_to_20() -> None:
    for n in range(1, 21):
        assert dart_to_no3({"segment": {"number": n, "multiplier": 1}}) == ("single", n)
        assert dart_to_no3({"segment": {"number": n, "multiplier": 2}}) == ("double", n)
        assert dart_to_no3({"segment": {"number": n, "multiplier": 3}}) == ("triple", n)
        assert label_to_kind_number(f"S{n}") == ("single", n)
        assert label_to_kind_number(f"D{n}") == ("double", n)
        assert label_to_kind_number(f"T{n}") == ("triple", n)


def test_fixture_bulls_and_miss() -> None:
    state = _load("state_bulls_miss.json")
    kinds = [dart_to_no3(t) for t in state["throws"]]
    assert kinds == [
        ("outer_bull", 25),
        ("bull", 50),
        ("miss", 0),
    ]


def test_fixture_three_darts() -> None:
    state = _load("state_three_darts.json")
    kinds = [dart_to_no3(t) for t in state["throws"]]
    assert kinds == [
        ("triple", 20),
        ("single", 5),
        ("double", 16),
    ]


@pytest.mark.parametrize(
    "status,expected",
    [
        ("Throw", False),
        ("Throw detected", False),
        ("Takeout", True),
        ("Takeout started", True),
        ("Takeout finished", True),
        ("takeout", True),
        ("Removing darts", True),
        ("removing darts…", True),
        ("Remove darts", True),
        ("Pull darts", True),
        ("", False),
    ],
)
def test_is_takeout_status(status: str, expected: bool) -> None:
    assert is_takeout_status(status) is expected


@pytest.mark.parametrize(
    "status,expected",
    [
        ("Takeout finished", True),
        ("TakeoutFinished", True),
        ("takeout_finished", True),
        ("Takeout", False),
        ("Takeout started", False),
        ("Throw", False),
    ],
)
def test_is_takeout_finished_status(status: str, expected: bool) -> None:
    assert is_takeout_finished_status(status) is expected
