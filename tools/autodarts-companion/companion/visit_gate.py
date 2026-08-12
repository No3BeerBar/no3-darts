"""
Visit / takeout gating for the Autodarts -> No3 bridge.

Autodarts Board Manager exposes takeout on `/api/state` as status/event
strings (fixtures: "Takeout", "Takeout started", "Takeout finished") while
`throws` may still hold the prior visit.

Critical ordering (bar P0):
  1. Mirror AD throw growth into No3 for the *current* seat first.
  2. Only then end-turn / freeze on takeout.
  3. Do not end-turn on takeout until 3 throws are visible (or board cleared).
  Otherwise dart 3 of a visit can miss the current player or land on the next
  after an empty-board unlock flicker.

After No3 closes a visit, freeze dart/correct posts until the board is empty
and AD has left takeout (or a scored close + empty board).
"""

from __future__ import annotations

from typing import Any, Optional

from .client import extract_status
from .mapping import is_takeout_finished_status, is_takeout_status


def is_takeout_state(state: Optional[dict[str, Any]]) -> bool:
    """
    True when Autodarts signals remove-darts / takeout.

    Checks dedicated status first, then event (some Board Manager builds put
    Takeout only on event while status lags).
    """
    if not isinstance(state, dict):
        return False
    status = extract_status(state)
    if is_takeout_status(status):
        return True
    for key in ("event", "Event"):
        val = state.get(key)
        if isinstance(val, str) and is_takeout_status(val):
            return True
    for nest in ("board", "Board", "state", "State", "data", "Data"):
        sub = state.get(nest)
        if isinstance(sub, dict):
            for key in ("status", "Status", "event", "Event"):
                val = sub.get(key)
                if isinstance(val, str) and is_takeout_status(val):
                    return True
    return False


def scoring_frozen(*, takeout: bool, visit_closed: bool) -> bool:
    """No dart/correct posts while AD takeout OR No3 visit already closed."""
    return bool(takeout or visit_closed)


def should_end_turn_on_takeout(
    *,
    visit_closed: bool,
    throws_count: int,
) -> bool:
    """
    Takeout must not advance the No3 seat before a full 3-dart visit is mirrored.

    AD often flips to Takeout while only 1-2 throws are in `/api/state`; dart 3
    arrives one poll later. Ending immediately advances the seat, then an empty
    flicker can unlock scoring so dart 3 posts onto the next player.

    End-turn on takeout only when we already closed via scoring, or all 3 throws
    are present (caller syncs APPEND first). Incomplete visits wait for dart 3
    or CLEARED while in_takeout (confirmed early pull).
    """
    if visit_closed:
        return False
    return int(throws_count) >= 3


def should_clear_stale_takeout(
    *,
    takeout: bool,
    in_takeout: bool,
    visit_closed: bool,
    throws_empty: bool = False,
) -> bool:
    """
    Drop sticky in_takeout when AD leaves takeout while throws remain.

    If the board is empty, keep in_takeout latched so consecutive-empty
    early-pull confirmation can still fire (do not clear on the first empty poll).
    """
    return bool(
        in_takeout and not takeout and not visit_closed and not throws_empty
    )


def should_end_turn_on_clear(
    *,
    takeout: bool,
    in_takeout: bool,
    visit_closed: bool,
    prev_throw_count: int = 0,
    takeout_finished: bool = False,
) -> bool:
    """
    CLEARED alone must not advance the seat mid-visit.

    AD can flicker throws=[] between dart 2 and dart 3 (with or without a
    Takeout blip). Only end-turn on clear when:
    - the No3 visit is already closed (3rd dart / prior end-turn), or
    - takeout is/was active AND we already mirrored a full 3-dart visit, or
    - takeout is/was active AND takeout finished (confirmed early 1-2 dart pull).

    Incomplete visit + takeout + empty flicker -> wait (retain prev throws).
    """
    if visit_closed:
        return True
    if not (takeout or in_takeout):
        return False
    if int(prev_throw_count) >= 3:
        return True
    return bool(takeout_finished)


def should_end_turn_on_empty_takeout_finished(
    *,
    visit_closed: bool,
    throws_empty: bool,
    in_takeout: bool,
    status: str,
) -> bool:
    """
    Early pull: board empty and AD reports takeout finished, visit still open.

    Covers the case where CLEARED already ran on a prior poll (prev_throws=[])
    so we only see UNCHANGED empty + Takeout finished.
    """
    if visit_closed or not throws_empty or not in_takeout:
        return False
    return is_takeout_finished_status(status)


def should_end_turn_leaving_takeout_empty(
    *,
    visit_closed: bool,
    throws_empty: bool,
    in_takeout: bool,
    takeout: bool,
    empty_polls: int = 0,
    min_empty_polls: int = 2,
) -> bool:
    """
    Early pull without a Takeout-finished string: empty board + left takeout.

    Require consecutive empty polls so a one-poll clear flicker between dart 2
    and dart 3 (after a Takeout blip) cannot seat-jump. Must run before clearing
    sticky in_takeout.
    """
    return bool(
        not visit_closed
        and throws_empty
        and in_takeout
        and not takeout
        and int(empty_polls) >= int(min_empty_polls)
    )


def should_unlock_next_visit(
    *,
    visit_closed: bool,
    takeout: bool,
    throws_empty: bool,
    saw_takeout_after_close: bool = False,
    closed_by_scoring: bool = False,
) -> bool:
    """
    Next thrower may score only after a closed visit sees a clean board.

    Require empty throws and Autodarts not in takeout, plus either:
    - we observed AD takeout after the close (normal remove-darts path), or
    - the visit was closed by scoring (turnEnded / 3 darts / bust) so an empty
      board without a Takeout string is enough.
    """
    if not visit_closed or not throws_empty or takeout:
        return False
    return bool(saw_takeout_after_close or closed_by_scoring)
