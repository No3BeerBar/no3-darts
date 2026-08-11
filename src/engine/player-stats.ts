/**
 * Live per-player round stats for /play seat cards.
 *
 * MPR = marks ÷ visits (Cricket / mark-based — Autodarts/league definition)
 * PPR = points ÷ visits (X01 and other point-scoring modes)
 *
 * Multi-leg matches display `currentLeg / overall`.
 */

import { cricketMarks, cricketNumber } from "./dart";
import { visitPointsFromTurn } from "./visit-score";
import type { DartThrow, GameModeId, GameState, Turn } from "./types";

export type RoundStatKind = "mpr" | "ppr";

export interface RoundStatValue {
  /** Current leg rate (null if no visits yet). */
  current: number | null;
  /** Match-wide rate (null if no visits yet). */
  overall: number | null;
}

export interface PlayerRoundStats {
  mpr: RoundStatValue | null;
  ppr: RoundStatValue | null;
}

/** Which live rates to show for a mode — hide nonsense for Baseball/41/Killer/etc. */
export function roundStatsForMode(mode: GameModeId): {
  mpr: boolean;
  ppr: boolean;
} {
  switch (mode) {
    case "cricket":
      return { mpr: true, ppr: false };
    case "x01":
    case "random_checkout":
    case "countup":
    case "shanghai":
      return { mpr: false, ppr: true };
    default:
      // Baseball, 41, Killer, Bermuda, ATC — no clean MPR/PPR mapping
      return { mpr: false, ppr: false };
  }
}

function cricketNumbers(state: GameState): number[] {
  if (state.modeConfig.mode !== "cricket") {
    return [20, 19, 18, 17, 16, 15, 25];
  }
  return state.modeConfig.config.numbers ?? [20, 19, 18, 17, 16, 15, 25];
}

/** Marks from a dart that land on Cricket numbers in play. */
export function marksFromDart(dart: DartThrow, numbers: number[]): number {
  const num = cricketNumber(dart);
  if (num === null || !numbers.includes(num)) return 0;
  return cricketMarks(dart);
}

function marksFromDarts(darts: DartThrow[], numbers: number[]): number {
  return darts.reduce((sum, d) => sum + marksFromDart(d, numbers), 0);
}

function rate(total: number, visits: number): number | null {
  if (visits <= 0) return null;
  return Math.round((total / visits) * 100) / 100;
}

function turnBelongsToLeg(turn: Turn, legNumber: number): boolean {
  // Untagged turns (pre-feature / legacy) count as leg 1 only when match is still on leg 1;
  // once past leg 1, untagged history is overall-only (not current).
  if (turn.legNumber == null) return legNumber === 1;
  return turn.legNumber === legNumber;
}

/**
 * Points credited for a visit. Bust → 0. Uses mode-aware visit helper for completed turns.
 */
function pointsFromCompletedTurn(mode: GameModeId, turn: Turn): number {
  return visitPointsFromTurn(mode, turn);
}

/** Provisional points for the live visit (pre-finalize). */
function pointsFromLiveDarts(mode: GameModeId, darts: DartThrow[]): number {
  if (darts.length === 0) return 0;
  // X01 / shanghai / random_checkout / countup: face value sum
  if (
    mode === "x01" ||
    mode === "shanghai" ||
    mode === "random_checkout" ||
    mode === "countup"
  ) {
    return darts.reduce((a, d) => a + d.value, 0);
  }
  return darts.reduce((a, d) => a + d.value, 0);
}

interface Accum {
  marks: number;
  points: number;
  visits: number;
}

function emptyAccum(): Accum {
  return { marks: 0, points: 0, visits: 0 };
}

/**
 * Compute live MPR/PPR for one player from turn history + current visit.
 * Updates as darts land and after undo/corrections (pure read of state).
 */
export function computePlayerRoundStats(
  state: GameState,
  playerId: string
): PlayerRoundStats {
  const show = roundStatsForMode(state.mode);
  if (!show.mpr && !show.ppr) {
    return { mpr: null, ppr: null };
  }

  const nums = cricketNumbers(state);
  const leg = emptyAccum();
  const match = emptyAccum();

  for (const turn of state.turns) {
    if (turn.playerId !== playerId) continue;
    const marks = show.mpr ? marksFromDarts(turn.darts, nums) : 0;
    const points = show.ppr ? pointsFromCompletedTurn(state.mode, turn) : 0;
    match.marks += marks;
    match.points += points;
    match.visits += 1;
    if (turnBelongsToLeg(turn, state.legNumber)) {
      leg.marks += marks;
      leg.points += points;
      leg.visits += 1;
    }
  }

  // Live visit (incomplete) — counts once the first dart is in
  const currentId = state.players[state.currentPlayerIndex]?.id;
  if (
    currentId === playerId &&
    state.currentTurnDarts.length > 0 &&
    (state.status === "playing" ||
      state.status === "leg_won" ||
      state.status === "match_won")
  ) {
    const marks = show.mpr ? marksFromDarts(state.currentTurnDarts, nums) : 0;
    const points = show.ppr
      ? pointsFromLiveDarts(state.mode, state.currentTurnDarts)
      : 0;
    match.marks += marks;
    match.points += points;
    match.visits += 1;
    leg.marks += marks;
    leg.points += points;
    leg.visits += 1;
  }

  return {
    mpr: show.mpr
      ? { current: rate(leg.marks, leg.visits), overall: rate(match.marks, match.visits) }
      : null,
    ppr: show.ppr
      ? {
          current: rate(leg.points, leg.visits),
          overall: rate(match.points, match.visits),
        }
      : null,
  };
}

/**
 * Format a live rate for seat cards.
 * Single-leg match → one number. Multi-leg → `current / overall`.
 * No visits yet → null (caller hides the row).
 */
export function formatRoundStat(
  value: RoundStatValue | null | undefined,
  multiLeg: boolean
): string | null {
  if (!value) return null;
  if (value.current == null && value.overall == null) return null;
  const cur =
    value.current == null ? "—" : value.current.toFixed(2);
  if (!multiLeg) {
    // Prefer current (same as overall on single-leg); fall back to overall
    if (value.current != null) return cur;
    return value.overall == null ? null : value.overall.toFixed(2);
  }
  const overall =
    value.overall == null ? "—" : value.overall.toFixed(2);
  return `${cur} / ${overall}`;
}

/** Tag newly appended turns with the current leg number (engine bookkeeping). */
export function tagNewTurnsWithLeg(
  state: GameState,
  previousTurnCount: number
): void {
  for (let i = previousTurnCount; i < state.turns.length; i++) {
    const t = state.turns[i];
    if (t.legNumber == null) {
      state.turns[i] = { ...t, legNumber: state.legNumber };
    }
  }
}
