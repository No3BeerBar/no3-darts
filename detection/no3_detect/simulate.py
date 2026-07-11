"""
Simulator: inject synthetic polar hits without cameras.
Useful for testing No3 API + scoring loop.
"""

from __future__ import annotations

import random
import time
from typing import Iterable, List

from rich.console import Console

from .api_client import No3Client
from .board_geometry import SegmentHit, polar_to_segment

console = Console()


def random_legal_hit() -> SegmentHit:
    # Bias toward high-scoring areas for fun demos
    if random.random() < 0.15:
        return polar_to_segment(random.uniform(0, 0.14), random.uniform(0, 360), confidence=0.9)
    if random.random() < 0.25:
        # near triple ring of 20
        return polar_to_segment(0.60, random.uniform(-8, 8), confidence=0.85)
    r = random.uniform(0.2, 0.98)
    a = random.uniform(0, 360)
    return polar_to_segment(r, a, confidence=random.uniform(0.7, 0.95))


def run_simulation(
    client: No3Client,
    *,
    count: int = 9,
    delay_s: float = 1.5,
    dry_run: bool = False,
    sequence: Iterable[SegmentHit] | None = None,
) -> List[dict]:
    hits = list(sequence) if sequence is not None else [random_legal_hit() for _ in range(count)]
    results = []
    for i, hit in enumerate(hits, 1):
        console.print(
            f"[{i}/{len(hits)}] {hit.kind} {hit.number} value={hit.value} conf={hit.confidence:.2f}"
        )
        try:
            resp = client.post_dart(hit, dry_run=dry_run)
            results.append(resp)
            console.print(f"  → {resp}")
        except Exception as e:
            console.print(f"  [red]fail: {e}[/red]")
            results.append({"error": str(e)})
        time.sleep(delay_s)
    return results


def classic_180_sequence() -> List[SegmentHit]:
    """Three T20s for a demo turn."""
    return [
        polar_to_segment(0.605, 0.0, confidence=0.95),
        polar_to_segment(0.605, 1.5, confidence=0.93),
        polar_to_segment(0.605, -1.2, confidence=0.94),
    ]
