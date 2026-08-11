/**
 * Mode-aware visit totals for history / Σ display.
 *
 * Do **not** sum raw `dart.value` for modes like Baseball (BULL → 50 on the
 * dart object, but 0 for the visit). Prefer `turn.endScore - turn.startScore`
 * when the engine stores cumulative mode points on those fields.
 *
 * Extensible per mode — keep helpers colocated when possible
 * (`baseballVisitPoints`, `fortyOneDartPoints`, …).
 */

import { baseballDartPoints, baseballVisitPoints } from "./modes/baseball";
import { fortyOneDartPoints, type FortyOneTarget } from "./modes/forty-one";
import type { DartThrow, GameModeId, Turn } from "./types";

/** Modes where turn start/end track accumulated visit points on `ps.score`. */
const SCORE_DELTA_MODES: ReadonlySet<GameModeId> = new Set([
  "baseball",
  "countup",
  "bermuda",
  "forty_one",
]);

/**
 * Points credited for a completed visit (one turn).
 * Bust → 0 (UI should still show the BUST label).
 */
export function visitPointsFromTurn(mode: GameModeId, turn: Turn): number {
  if (turn.bust) return 0;

  if (SCORE_DELTA_MODES.has(mode)) {
    return turn.endScore - turn.startScore;
  }

  // X01 / random checkout / shanghai: dart.value is the mode contribution.
  // Cricket / killer / ATC: start/end are not visit points — fall back to dart sum
  // for a rough “what was thrown” total (marks/lives matter more than Σ).
  // Future modes: prefer score delta when start ≠ end, else dart sum.
  const delta = turn.endScore - turn.startScore;
  if (
    mode !== "x01" &&
    mode !== "random_checkout" &&
    mode !== "shanghai" &&
    mode !== "cricket" &&
    mode !== "killer" &&
    mode !== "around_the_clock" &&
    delta !== 0
  ) {
    return delta;
  }

  return turn.darts.reduce((a, d) => a + d.value, 0);
}

/**
 * Per-dart points for display (current visit slots / history).
 * Pass `inning` for Baseball (1–9). Unknown context → dart.value.
 */
export function dartPointsForMode(
  mode: GameModeId,
  dart: DartThrow,
  ctx?: { inning?: number }
): number {
  if (mode === "baseball") {
    const inning = ctx?.inning;
    if (inning == null) return 0;
    return baseballDartPoints(dart, inning);
  }
  // Hook for future modes (e.g. 41) — default to segment value.
  return dart.value;
}

/** Baseball visit total from darts + inning (unit-test / rebuild helper). */
export function baseballVisitTotalFromDarts(
  darts: DartThrow[],
  inning: number
): number {
  return baseballVisitPoints(darts, inning);
}
