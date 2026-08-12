"""
Visit / takeout gating for the Autodarts -> No3 bridge.

Autodarts Board Manager `/api/state` (real fields from Autodarts docs +
local integrations such as ioBroker/HA):
  - status: Board State - "Throw", "Throw detected", "Takeout",
    "Takeout started", "Takeout finished"
  - event: Detection State - "Wait", "Stable", "Empty", "Dart", "Hand",
    "Partial Takeout", "Takeout"
  - throws / numThrows: counted darts (often still present during Takeout)

Active remove-darts = Takeout / Takeout started / Hand / Partial Takeout /
"Removing darts". "Takeout finished" means takeout completed - must NOT
keep scoring frozen.

Critical ordering (bar P0):
  1. Mirror AD throw growth into No3 for the *current* seat first.
  2. Only then end-turn / freeze on takeout.
  3. Never auto end-turn an incomplete (1-2 dart) visit - dart 3 often lags
     several seconds after a Takeout/empty flicker. Incomplete early pull is
     confirmed only by the patron Ready / reset control on /play.
  4. While mirroring an open AD visit, lock the No3 seat; refuse dart/end-turn
     that would apply to a different seat than the visit started on.
  5. After a visit closes, do not unlock on scored-close alone - require an AD
     takeout handshake or patron Ready so residual dart 3 cannot start the
     next seat. Freeze until board empty and AD left *active* takeout (or Ready).
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

from .client import extract_status, throw_identity
from .mapping import format_segment_label, is_takeout_finished_status, is_takeout_status

# Kept for tests / docs. Auto early-pull no longer ends incomplete visits;
# patron Ready is the incomplete path. Value still describes "sustained empty"
# windows used in historical regressions.
INCOMPLETE_VISIT_MIN_EMPTY_POLLS = 4


def is_takeout_state(state: Optional[dict[str, Any]]) -> bool:
    """
    True when Autodarts signals *active* remove-darts / takeout.

    Prefers Board State (`status`), then Detection State (`event`).
    "Takeout finished" is not active - unlock / Ready may proceed.
    """
    if not isinstance(state, dict):
        return False
    status = extract_status(state)
    # Finished board state wins over a lagging detection event
    if is_takeout_finished_status(status):
        return False
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
                if not isinstance(val, str):
                    continue
                if key.lower() in ("status",) and is_takeout_finished_status(val):
                    return False
                if is_takeout_status(val):
                    return True
    return False


def scoring_frozen(*, takeout: bool, visit_closed: bool) -> bool:
    """
    High-level freeze signal for UI / health.

    Live bridge still allows APPEND of dart 3 while takeout is active and the
    No3 visit is open (same-poll Takeout + 3 throws). Dart/correct freeze hard
    once visit_closed.
    """
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

    End-turn on takeout only when all 3 throws are present (caller syncs APPEND
    first). Incomplete visits wait for dart 3 or patron Ready reset.
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

    If the board is empty, keep in_takeout latched so takeout UI stays up until
    Ready / real clear (do not clear on the first empty poll).
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

    Incomplete visit + takeout + empty / takeout-finished flicker -> wait.
    Early 1-2 dart pulls confirm via patron Ready only (not auto empty polls).
    """
    if visit_closed:
        return True
    if not (takeout or in_takeout):
        return False
    if int(prev_throw_count) >= 3:
        return True
    # takeout_finished with <3 is intentionally ignored here (P0 seat jump).
    _ = takeout_finished
    return False


def should_end_turn_on_empty_takeout_finished(
    *,
    visit_closed: bool,
    throws_empty: bool,
    in_takeout: bool,
    status: str,
    empty_polls: int = 0,
    min_empty_polls: int = INCOMPLETE_VISIT_MIN_EMPTY_POLLS,
) -> bool:
    """
    P0: never auto end-turn on Takeout-finished + empty while visit still open.

    Dart 3 routinely lags >1-2s after AD flickers empty/takeout-finished.
    Auto early-pull was seat-jumping every visit. Incomplete visits end only
    via patron Ready (`handle_takeout_ready_ack` -> maybe_end_turn).
    """
    _ = (
        visit_closed,
        throws_empty,
        in_takeout,
        status,
        empty_polls,
        min_empty_polls,
    )
    return False


def should_end_turn_leaving_takeout_empty(
    *,
    visit_closed: bool,
    throws_empty: bool,
    in_takeout: bool,
    takeout: bool,
    empty_polls: int = 0,
    min_empty_polls: int = INCOMPLETE_VISIT_MIN_EMPTY_POLLS,
) -> bool:
    """
    P0: never auto end-turn after leaving takeout with an empty board.

    Same dart-3 lag race as takeout-finished empty. Patron Ready only.
    """
    _ = (
        visit_closed,
        throws_empty,
        in_takeout,
        takeout,
        empty_polls,
        min_empty_polls,
    )
    return False


def should_unlock_next_visit(
    *,
    visit_closed: bool,
    takeout: bool,
    throws_empty: bool,
    saw_takeout_after_close: bool = False,
    closed_by_scoring: bool = False,
    patron_ready: bool = False,
) -> bool:
    """
    Next thrower may score only after a closed visit sees a clean board.

    Patron Ready may unlock even if AD takeout status is sticky.
    Otherwise require empty throws, not in *active* takeout, and a real takeout
    handshake after close. Scored-close alone is NOT enough - that unlocked
    too early for residual / late dart 3 after an empty flicker.
    "Takeout finished" is not active takeout - callers pass takeout=False then.
    """
    _ = closed_by_scoring
    if not visit_closed or not throws_empty:
        return False
    if patron_ready:
        return True
    if takeout:
        return False
    return bool(saw_takeout_after_close)


def seat_matches_lock(
    *,
    locked_seat: Optional[int],
    current_seat: Optional[int],
) -> bool:
    """
    Hard invariant: while a visit seat is locked, only that No3 seat may score.

    Missing / unknown current seat fails closed when a lock is held.
    """
    if locked_seat is None:
        return True
    if current_seat is None:
        return False
    try:
        return int(locked_seat) == int(current_seat)
    except (TypeError, ValueError):
        return False


def _label_list(throws: Sequence[dict[str, Any]]) -> list[str]:
    return [format_segment_label(d) for d in throws]


def is_ad_visit_continuation(
    closed_throws: Sequence[dict[str, Any]],
    current_throws: Sequence[dict[str, Any]],
) -> bool:
    """
    True when current AD throws continue a visit we already closed/ended.

    After a premature end-turn + empty unlock, AD often re-shows the same
    prefix plus late dart 3 - sometimes with new tip coords. Posting that
    onto the next seat is the P0 bleed.
    """
    if not closed_throws or not current_throws:
        return False

    last_ids = [throw_identity(d) for d in closed_throws]
    curr_ids = [throw_identity(d) for d in current_throws]
    if len(curr_ids) >= len(last_ids) and curr_ids[: len(last_ids)] == last_ids:
        return True
    if len(last_ids) >= len(curr_ids) and last_ids[: len(curr_ids)] == curr_ids:
        return True

    # Coords often change on re-detect - match segment labels only
    last_labels = _label_list(closed_throws)
    curr_labels = _label_list(current_throws)
    if (
        len(curr_labels) >= len(last_labels)
        and curr_labels[: len(last_labels)] == last_labels
    ):
        return True
    if (
        len(last_labels) >= len(curr_labels)
        and last_labels[: len(curr_labels)] == curr_labels
    ):
        return True

    # Residual last dart of a full visit reappearing alone after unlock
    if len(closed_throws) >= 3 and len(current_throws) == 1:
        if curr_labels[0] == last_labels[-1]:
            return True

    # Incomplete close: singleton re-detect of an already-mirrored dart
    if len(closed_throws) < 3 and len(current_throws) == 1:
        if curr_labels[0] in set(last_labels):
            return True

    return False
