"""
Map Autodarts Board Manager segments -> No3 camera {kind, number}.

Autodarts state JSON varies by Board Manager version. Prefer
segment.number + segment.multiplier when present; fall back to segment.name
/ flat string labels (T20, S5, Bull, 25, Miss, ...).
"""

from __future__ import annotations

from typing import Any, Optional

# No3 SegmentKind values
KIND_SINGLE = "single"
KIND_DOUBLE = "double"
KIND_TRIPLE = "triple"
KIND_OUTER_BULL = "outer_bull"
KIND_BULL = "bull"
KIND_MISS = "miss"

No3Dart = tuple[str, int]  # (kind, number)


def label_to_kind_number(label: str) -> No3Dart:
    """Parse a human/AD segment label into No3 kind + number."""
    lab = (label or "").upper().strip()
    lab = lab.replace(" ", "").replace("_", "")

    if not lab:
        return KIND_MISS, 0

    # Bull variants
    if lab in ("BULL", "DBULL", "DB", "50", "BULLSEYE", "INNERBULL", "IBULL"):
        return KIND_BULL, 50
    if lab in ("25", "SBULL", "OUTER", "SB", "OUTERBULL", "OBULL", "SINGLEBULL"):
        return KIND_OUTER_BULL, 25

    # Miss / outside
    if lab in ("MISS", "0", "M", "OUT", "OUTSIDE", "NONE"):
        return KIND_MISS, 0
    if lab.startswith("M") and lab[1:].isdigit():
        return KIND_MISS, 0

    # Multiplier prefixes
    if lab.startswith("T") and lab[1:].isdigit():
        n = int(lab[1:])
        if n == 25:
            # Extremely rare; treat as bull-ish miss of mapping
            return KIND_BULL, 50
        return KIND_TRIPLE, n
    if lab.startswith("D") and lab[1:].isdigit():
        n = int(lab[1:])
        if n == 25 or n == 50:
            return KIND_BULL, 50
        return KIND_DOUBLE, n
    if lab.startswith("S") and lab[1:].isdigit():
        n = int(lab[1:])
        if n == 25:
            return KIND_OUTER_BULL, 25
        if n == 50:
            return KIND_BULL, 50
        return KIND_SINGLE, n

    if lab.isdigit():
        n = int(lab)
        if n == 0:
            return KIND_MISS, 0
        if n == 25:
            return KIND_OUTER_BULL, 25
        if n == 50:
            return KIND_BULL, 50
        return KIND_SINGLE, n

    return KIND_MISS, 0


def _segment_dict(dart: dict[str, Any]) -> Optional[dict[str, Any]]:
    for key in ("segment", "Segment", "seg", "Seg"):
        seg = dart.get(key)
        if isinstance(seg, dict):
            return seg
        if isinstance(seg, str) and seg.strip():
            return {"name": seg}
    return None


def format_segment_label(dart: dict[str, Any]) -> str:
    """Best-effort Autodarts-style label (T20, D16, 20, Bull, Miss)."""
    seg = _segment_dict(dart)
    if seg:
        name = seg.get("name") or seg.get("Name") or ""
        if name:
            return str(name)
        num = seg.get("number") if "number" in seg else seg.get("Number")
        mult = seg.get("multiplier") if "multiplier" in seg else seg.get("Multiplier")
        if num is not None and mult is not None:
            try:
                n, m = int(num), int(mult)
            except (TypeError, ValueError):
                n, m = None, None  # type: ignore[assignment]
            if n is not None and m is not None:
                if m == 0 or n == 0:
                    return "Miss"
                if n == 25:
                    return "Bull" if m >= 2 else "25"
                if n == 50:
                    return "Bull"
                if m == 3:
                    return f"T{n}"
                if m == 2:
                    return f"D{n}"
                return f"S{n}" if m == 1 else str(n)

    for k in ("name", "label", "scoreName", "text", "Name", "Label"):
        if dart.get(k):
            return str(dart[k])

    # Bare number/multiplier on the dart itself
    if "number" in dart and "multiplier" in dart:
        try:
            return format_segment_label({"segment": dart})
        except Exception:
            pass

    return "Miss"


def dart_to_no3(dart: Any) -> No3Dart:
    """
    Convert one Autodarts throw object (or string label) to No3 (kind, number).

    Prefer numeric segment fields - they are stable across Board Manager versions.
    """
    if dart is None:
        return KIND_MISS, 0

    if isinstance(dart, str):
        return label_to_kind_number(dart)

    if not isinstance(dart, dict):
        return KIND_MISS, 0

    # Flat kind already in No3 shape (passthrough)
    kind = dart.get("kind")
    if isinstance(kind, str) and kind in {
        KIND_SINGLE,
        KIND_DOUBLE,
        KIND_TRIPLE,
        KIND_OUTER_BULL,
        KIND_BULL,
        KIND_MISS,
    }:
        num = dart.get("number", 0)
        try:
            return kind, int(num)
        except (TypeError, ValueError):
            return kind, 0

    seg = _segment_dict(dart)
    if seg is not None:
        num = seg.get("number") if "number" in seg else seg.get("Number")
        mult = seg.get("multiplier") if "multiplier" in seg else seg.get("Multiplier")
        name = str(seg.get("name") or seg.get("Name") or "")

        # Multiplier + number path (canonical AD shape)
        if num is not None and mult is not None:
            try:
                n, m = int(num), int(mult)
            except (TypeError, ValueError):
                n, m = -1, -1
            if n >= 0 and m >= 0:
                if m == 0 or n == 0:
                    return KIND_MISS, 0
                if n == 25:
                    return (KIND_BULL, 50) if m >= 2 else (KIND_OUTER_BULL, 25)
                if n == 50:
                    return KIND_BULL, 50
                if m == 3 and 1 <= n <= 20:
                    return KIND_TRIPLE, n
                if m == 2 and 1 <= n <= 20:
                    return KIND_DOUBLE, n
                if m == 1 and 1 <= n <= 20:
                    return KIND_SINGLE, n

        if name:
            return label_to_kind_number(name)

    label = format_segment_label(dart)
    return label_to_kind_number(label)


def is_takeout_status(status: str) -> bool:
    """True when Board Manager signals visit / takeout boundary."""
    s = (status or "").strip().lower()
    if not s:
        return False
    # Exact / common board states from Autodarts docs
    if s in {
        "takeout",
        "takeout started",
        "takeout finished",
        "takeoutstarted",
        "takeoutfinished",
    }:
        return True
    # Be resilient to "Board: Takeout" / "status=Takeout" style strings
    return "takeout" in s.replace("_", " ")


def is_takeout_finished_status(status: str) -> bool:
    """True when AD signals darts have been removed (takeout complete)."""
    s = (status or "").strip().lower().replace("_", " ")
    if not s:
        return False
    return "takeout finished" in s or s.replace(" ", "") == "takeoutfinished"
