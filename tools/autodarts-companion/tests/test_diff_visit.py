"""Tests for visit diffing (append vs Autodarts-style correction)."""

from __future__ import annotations

from companion.client import (
    VISIT_APPEND,
    VISIT_CLEARED,
    VISIT_REPLACE,
    VISIT_UNCHANGED,
    diff_visit,
    extract_camera_health,
    new_throws_since,
)
from companion.mapping import dart_to_no3


def _seg(name: str, number: int, mult: int) -> dict:
    return {"segment": {"name": name, "number": number, "multiplier": mult}}


def test_diff_unchanged() -> None:
    t = [_seg("T20", 20, 3)]
    d = diff_visit(t, list(t))
    assert d["kind"] == VISIT_UNCHANGED
    assert d["appended"] == []


def test_diff_append() -> None:
    prev = [_seg("T20", 20, 3)]
    curr = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    d = diff_visit(prev, curr)
    assert d["kind"] == VISIT_APPEND
    assert len(d["appended"]) == 1
    assert dart_to_no3(d["appended"][0]) == ("single", 5)
    # Back-compat helper still agrees
    assert new_throws_since(prev, curr) == d["appended"]


def test_diff_correction_same_length() -> None:
    prev = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    curr = [_seg("T19", 19, 3), _seg("5", 5, 1)]
    d = diff_visit(prev, curr)
    assert d["kind"] == VISIT_REPLACE
    assert [dart_to_no3(x) for x in d["throws"]] == [
        ("triple", 19),
        ("single", 5),
    ]
    assert new_throws_since(prev, curr) == []


def test_diff_correction_replace_second_dart() -> None:
    prev = [_seg("T20", 20, 3), _seg("S1", 1, 1)]
    curr = [_seg("T20", 20, 3), _seg("D16", 16, 2)]
    d = diff_visit(prev, curr)
    assert d["kind"] == VISIT_REPLACE
    assert dart_to_no3(d["throws"][1]) == ("double", 16)


def test_diff_mid_visit_shrink() -> None:
    prev = [_seg("T20", 20, 3), _seg("5", 5, 1)]
    curr = [_seg("T20", 20, 3)]
    d = diff_visit(prev, curr)
    assert d["kind"] == VISIT_REPLACE
    assert len(d["throws"]) == 1
    assert new_throws_since(prev, curr) == []


def test_diff_cleared() -> None:
    prev = [_seg("T20", 20, 3)]
    d = diff_visit(prev, [])
    assert d["kind"] == VISIT_CLEARED


def test_diff_first_poll() -> None:
    curr = [_seg("T20", 20, 3)]
    d = diff_visit([], curr)
    assert d["kind"] == VISIT_APPEND
    assert len(d["appended"]) == 1


def test_extract_camera_health_fps_list() -> None:
    state = {
        "status": "Throw",
        "cameras": [
            {"fps": 30, "connected": True},
            {"fps": 28, "connected": True},
            {"fps": 0, "connected": False},
        ],
    }
    h = extract_camera_health(state)
    assert h["connected"] is False
    assert h["ok"] is False
    assert h["reason"] == "camera_disconnected"
    assert h["min_fps"] == 0.0


def test_extract_camera_health_ok_without_fps() -> None:
    """Reachable state with no FPS telemetry is treated as ok."""
    h = extract_camera_health({"status": "Throw", "throws": []})
    assert h["ok"] is True
    assert h["status"] == "Throw"
