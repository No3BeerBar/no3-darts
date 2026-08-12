"""
Visit / takeout gating for the Autodarts -> No3 bridge.

Autodarts Board Manager exposes takeout on `/api/state` as status/event
strings (fixtures: "Takeout", "Takeout started", "Takeout finished") while
`throws` may still hold the prior visit.

Critical ordering (bar P0):
  1. Mirror AD throw growth into No3 for the *current* seat first.
  2. Only then end-turn / freeze on takeout.
  Otherwise dart 3 of a visit can miss the current player or land on the next.

After No3 closes a visit, freeze dart/correct posts until the board is empty
and AD has left takeout (or a scored close + empty board).
"""

from __future__ import annotations

from typing import Any, Optional

from .client import extract_status
from .mapping import is_takeout_status


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


def should_end_turn_on_clear(
    *,
    takeout: bool,
    in_takeout: bool,
    visit_closed: bool,
) -> bool:
    """
    CLEARED alone must not advance the seat mid-visit.

    AD can flicker throws=[] between dart 2 and dart 3 while status is still
    Throw / Throw detected. Only end-turn on clear when takeout is/was active
    or the No3 visit is already closed (3rd dart / prior end-turn).
    """
    return bool(takeout or in_takeout or visit_closed)


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
