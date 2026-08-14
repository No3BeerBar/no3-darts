/**
 * 41 (John’s rules).
 * Start at 60. Ten rounds; valid hits add; complete miss → score halved (ceil).
 * Order: 20, 19, any double, 18, 17, any triple, 16, 15, exact 41, bulls.
 * Round “41”: all 3 darts must contribute (no miss / zero) and sum exactly to 41
 * → add 41 only; else halve.
 * Highest total wins. Ties: first among equal high scores (Shanghai / Baseball).
 */

import { segmentLabel, segmentValue } from "../dart";
import type { ApplyDartResult, DartThrow, EngineEvent, GameState } from "../types";
import { advanceThrower, syncTeamSharedState } from "../teams";
import {
  cloneState,
  createEmptyPlayerState,
  currentPlayer,
  currentPlayerState,
  type GameModeHandler,
} from "./base";

export type FortyOneTarget =
  | { type: "number"; n: number }
  | { type: "any_double" }
  | { type: "any_triple" }
  | { type: "exact_41" }
  | { type: "bull" };

export const FORTY_ONE_START_SCORE = 60;

export const FORTY_ONE_SEQUENCE: FortyOneTarget[] = [
  { type: "number", n: 20 },
  { type: "number", n: 19 },
  { type: "any_double" },
  { type: "number", n: 18 },
  { type: "number", n: 17 },
  { type: "any_triple" },
  { type: "number", n: 16 },
  { type: "number", n: 15 },
  { type: "exact_41" },
  { type: "bull" },
];

export function fortyOneTarget(state: GameState): FortyOneTarget {
  return FORTY_ONE_SEQUENCE[state.roundIndex] ?? FORTY_ONE_SEQUENCE[0];
}

export function fortyOneRoundNumber(state: GameState): number {
  return Math.min(FORTY_ONE_SEQUENCE.length, state.roundIndex + 1);
}

export function fortyOneTargetLabel(t: FortyOneTarget): string {
  switch (t.type) {
    case "number":
      return String(t.n);
    case "any_double":
      return "ANY DOUBLE";
    case "any_triple":
      return "ANY TRIPLE";
    case "exact_41":
      return "41 EXACT";
    case "bull":
      return "BULL";
  }
}

/** Board highlight hints for scoring / TV dartboards. */
export function fortyOneBoardFocus(t: FortyOneTarget): {
  focusNumber: number | null;
  focusRing: "double" | "triple" | null;
  focusBull: boolean;
} {
  switch (t.type) {
    case "number":
      return { focusNumber: t.n, focusRing: null, focusBull: false };
    case "any_double":
      return { focusNumber: null, focusRing: "double", focusBull: false };
    case "any_triple":
      return { focusNumber: null, focusRing: "triple", focusBull: false };
    case "exact_41":
      return { focusNumber: null, focusRing: null, focusBull: false };
    case "bull":
      return { focusNumber: null, focusRing: null, focusBull: true };
  }
}

/** Ceiling of score / 2 (miss penalty). */
export function fortyOneHalve(score: number): number {
  return Math.ceil(score / 2);
}

/**
 * Points one dart scores toward the current round target.
 * For exact_41, returns the dart’s face value (miss / zero → 0);
 * visit success is decided separately (all 3 must contribute and sum to 41).
 */
export function fortyOneDartPoints(dart: DartThrow, target: FortyOneTarget): number {
  switch (target.type) {
    case "number":
      if (
        (dart.kind === "single" || dart.kind === "double" || dart.kind === "triple") &&
        dart.number === target.n
      ) {
        return segmentValue(dart.kind, dart.number);
      }
      return 0;
    case "any_double":
      // D1–D20, or inner bull (treated as double / 50)
      if (dart.kind === "double" || dart.kind === "bull") {
        return dart.value;
      }
      return 0;
    case "any_triple":
      return dart.kind === "triple" ? dart.value : 0;
    case "exact_41":
      return dart.value;
    case "bull":
      if (dart.kind === "outer_bull") return 25;
      if (dart.kind === "bull") return 50;
      return 0;
  }
}

/** Exact-41: dart must land on the board with a positive face value (miss voids the visit). */
export function fortyOneExact41DartContributes(dart: DartThrow): boolean {
  return dart.kind !== "miss" && dart.value > 0;
}

/** Exact-41 success: 3 contributing darts whose face values sum to exactly 41. */
export function fortyOneExact41VisitOk(darts: DartThrow[]): boolean {
  if (darts.length !== 3) return false;
  for (const d of darts) {
    if (d.kind === "miss" || d.value <= 0) return false;
  }
  return darts.reduce((a, d) => a + d.value, 0) === 41;
}

/** Exact-41: visit sum already over 41 — cannot recover; turn is done. */
export function fortyOneExact41GoneOver(darts: DartThrow[]): boolean {
  return darts.reduce((a, d) => a + d.value, 0) > 41;
}

export function fortyOneVisitRawSum(darts: DartThrow[], target: FortyOneTarget): number {
  return darts.reduce((sum, d) => sum + fortyOneDartPoints(d, target), 0);
}

/**
 * Result of a completed visit against a target.
 * - Normal rounds: add sum of valid dart points; 0 valid → halved
 * - exact_41: exactly 3 darts, each must contribute (not miss / value<=0),
 *   sum must be 41 → +41; else halved.
 *   T7(21)+S20(20)+MISS(0) = 41 arithmetically → HALVED (miss does not contribute).
 */
export function fortyOneVisitResult(
  darts: DartThrow[],
  target: FortyOneTarget
): { kind: "scored"; points: number } | { kind: "halved" } {
  if (target.type === "exact_41") {
    // Require exactly 3 darts
    if (darts.length !== 3) return { kind: "halved" };
    // Every dart must contribute — reject miss or non-positive value
    for (const d of darts) {
      if (d.kind === "miss" || d.value <= 0) return { kind: "halved" };
    }
    const sum = darts[0].value + darts[1].value + darts[2].value;
    if (sum === 41) return { kind: "scored", points: 41 };
    return { kind: "halved" };
  }
  const pts = fortyOneVisitRawSum(darts, target);
  if (pts > 0) return { kind: "scored", points: pts };
  return { kind: "halved" };
}

export const fortyOneHandler: GameModeHandler = {
  id: "forty_one",
  displayName: "41",
  description:
    "Start 60 · hit the round target to add · miss all → score halved (ceil) · exact-41: all 3 darts must score and total 41 · highest wins",
  leaderboard: { highScore: true },

  initLeg(state: GameState): GameState {
    const next = cloneState(state);
    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const base = createEmptyPlayerState(p, FORTY_ONE_START_SCORE);
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
      }
      base.extra = { lastVisitPoints: null as number | null, lastVisitHalved: false };
      return base;
    });
    next.roundIndex = 0;
    next.currentTurnDarts = [];
    next.legWinnerId = null;
    next.status = "playing";
    return next;
  },

  applyDart(state: GameState, dart: DartThrow): ApplyDartResult {
    const next = cloneState(state);
    const events: EngineEvent[] = [{ type: "dart", payload: dart, timestamp: Date.now() }];
    const ps = currentPlayerState(next);
    const target = fortyOneTarget(next);
    const points = fortyOneDartPoints(dart, target);

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;

    const label = segmentLabel(dart.kind, dart.number);
    let callout: string;
    if (target.type === "exact_41") {
      const sum = next.currentTurnDarts.reduce((a, d) => a + d.value, 0);
      callout = `${label} · Σ${sum}`;
    } else {
      callout = points > 0 ? `${label} · +${points}` : `${label} · 0`;
    }
    return { state: next, events, callout };
  },

  shouldEndTurn(state: GameState): boolean {
    if (state.status !== "playing") return false;
    if (state.currentTurnDarts.length >= 3) return true;
    // Exact 41: over remaining 41 (e.g. T19 first dart) ends the visit now.
    // Do not wait for darts 2 and 3 — same as X01 bust.
    return (
      fortyOneTarget(state).type === "exact_41" &&
      fortyOneExact41GoneOver(state.currentTurnDarts)
    );
  },

  getStatusLine(state: GameState): string {
    const t = fortyOneTarget(state);
    const n = fortyOneRoundNumber(state);
    return `41 · Round ${n}/${FORTY_ONE_SEQUENCE.length} · ${fortyOneTargetLabel(t)}`;
  },
};

export function finalizeFortyOneTurn(state: GameState): ApplyDartResult {
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.currentTurnDarts.length === 0) return { state: next, events };

  const player = currentPlayer(next);
  const ps = currentPlayerState(next);
  const target = fortyOneTarget(next);
  const startScore = ps.score;
  const result = fortyOneVisitResult(next.currentTurnDarts, target);

  let callout: string | undefined;
  if (result.kind === "halved") {
    ps.score = fortyOneHalve(ps.score);
    ps.extra = { ...ps.extra, lastVisitPoints: 0, lastVisitHalved: true };
    callout =
      target.type === "exact_41" && fortyOneExact41GoneOver(next.currentTurnDarts)
        ? "BUST"
        : "HALVED";
  } else {
    ps.score += result.points;
    ps.totalScore += result.points;
    ps.extra = {
      ...ps.extra,
      lastVisitPoints: result.points,
      lastVisitHalved: false,
    };
    callout = `+${result.points}`;
  }

  const turn = {
    playerId: player.id,
    darts: [...next.currentTurnDarts],
    startScore,
    endScore: ps.score,
    bust: result.kind === "halved",
    checkout: false,
    timestamp: Date.now(),
  };
  next.turns.push(turn);
  next.currentTurnDarts = [];

  syncTeamSharedState(next, player.id);
  const wrapped = advanceThrower(next);
  if (wrapped) {
    next.roundIndex += 1;
    if (next.roundIndex >= FORTY_ONE_SEQUENCE.length) {
      const seen = new Set<string>();
      const leaders = next.playerStates.filter((p) => {
        const tid = p.teamId ?? p.playerId;
        if (seen.has(tid)) return false;
        seen.add(tid);
        return true;
      });
      const sorted = [...leaders].sort((a, b) => b.score - a.score);
      // Tie-break: first among equal high scores (same as Shanghai / Baseball)
      next.legWinnerId = sorted[0].playerId;
      sorted[0].legsWon += 1;
      syncTeamSharedState(next, sorted[0].playerId);
      next.status = "leg_won";
      events.push({
        type: "leg_won",
        payload: { playerId: sorted[0].playerId },
        timestamp: Date.now(),
      });
      if (sorted[0].legsWon >= next.matchFormat.legsToWin) {
        sorted[0].setsWon += 1;
        syncTeamSharedState(next, sorted[0].playerId);
        if (sorted[0].setsWon >= next.matchFormat.setsToWin) {
          next.status = "match_won";
          next.winnerId = sorted[0].playerId;
        }
      }
      return { state: next, events, callout: result.kind === "halved" ? "HALVED" : "FINAL" };
    }
  }
  events.push({ type: "turn_end", payload: turn, timestamp: Date.now() });
  return { state: next, events, callout };
}
