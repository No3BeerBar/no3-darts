"""
Autodarts-style visit flow for the detector.

States:
  THROWING     – accept dart hits (up to 3)
  WAIT_TAKEOUT – pause scoring; watch for hands / board clear → next visit
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Tuple

from .board_geometry import SegmentHit


class VisitPhase(str, Enum):
    THROWING = "throwing"
    WAIT_TAKEOUT = "wait_takeout"


@dataclass
class PendingCandidate:
    hit: SegmentHit
    tip_xy: Tuple[float, float]
    count: int = 1
    first_ms: float = 0.0
    last_ms: float = 0.0


@dataclass
class VisitController:
    """Tracks darts this visit + takeout / hand-pull."""

    darts_this_visit: int = 0
    phase: VisitPhase = VisitPhase.THROWING
    last_hit: Optional[SegmentHit] = None
    last_tip: Optional[Tuple[float, float]] = None
    # Consensus buffer before posting
    candidate: Optional[PendingCandidate] = None
    # Takeout motion tracking
    takeout_motion_streak: int = 0
    takeout_quiet_streak: int = 0
    saw_hand_motion: bool = False
    phase_entered_ms: float = 0.0
    posted_keys: List[Tuple[str, int]] = field(default_factory=list)

    def reset_visit(self) -> None:
        self.darts_this_visit = 0
        self.phase = VisitPhase.THROWING
        self.last_hit = None
        self.last_tip = None
        self.candidate = None
        self.takeout_motion_streak = 0
        self.takeout_quiet_streak = 0
        self.saw_hand_motion = False
        self.posted_keys.clear()

    def enter_takeout(self, now_ms: float) -> None:
        self.phase = VisitPhase.WAIT_TAKEOUT
        self.phase_entered_ms = now_ms
        self.candidate = None
        self.takeout_motion_streak = 0
        self.takeout_quiet_streak = 0
        self.saw_hand_motion = False

    def note_posted(self, hit: SegmentHit, tip: Optional[Tuple[float, float]], now_ms: float) -> None:
        self.darts_this_visit += 1
        self.last_hit = hit
        self.last_tip = tip
        self.posted_keys.append((hit.kind, hit.number))
        self.candidate = None
        if self.darts_this_visit >= 3:
            self.enter_takeout(now_ms)
