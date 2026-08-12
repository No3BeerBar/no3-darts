"""
Visit / takeout gating for the Autodarts -> No3 bridge.

Autodarts Board Manager exposes takeout on `/api/state` as status/event
strings (fixtures: "Takeout", "Takeout started", "Takeout finished") while
`throws` may still hold the prior visit. After No3 ends a turn, the bridge
must freeze dart/correct posts until the board is empty AND AD leaves
takeout - otherwise P1's last dart can APPEND/REPLACE onto P2.
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


def should_unlock_next_visit(
    *,
    visit_closed: bool,
    takeout: bool,
    throws_empty: bool,
) -> bool:
    """
    Next thrower may score only after a closed visit sees a clean board:
    empty throws and Autodarts not in takeout/remove-darts.
    """
    return bool(visit_closed and throws_empty and not takeout)
