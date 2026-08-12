/**
 * Pure timed-challenge rule engine.
 * Evaluates goal definitions against a finished match's `GameState.turns`.
 * ONLY uncorrected visits count — see `isEligibleVisit` / `eligibleDarts`.
 */

import type { DartThrow, GameState, SegmentKind, Turn } from "@/engine/types";
import { visitPointsFromTurn } from "@/engine/visit-score";

export type ChallengeStack = "once" | "every";

export type ChallengeRuleType =
  | "bull"
  | "checkout_min"
  | "visit_score"
  | "one_eighty"
  | "segment_hit"
  | "match_win"
  | "legs_won";

export interface ChallengeGoalDef {
  id: string;
  ruleType: ChallengeRuleType;
  params: Record<string, unknown>;
  points: number;
  /** once = award points at most once per match; every = points × occurrences */
  stack: ChallengeStack;
}

export interface ChallengeCredit {
  goalId: string;
  points: number;
  occurrences: number;
  evidence?: unknown;
}

/** Visit eligible for challenge credit: not edited, no bot darts. */
export function isEligibleVisit(turn: Turn): boolean {
  if (turn.edited) return false;
  if (turn.darts.some((d) => d.source === "bot")) return false;
  return true;
}

/** Darts that count toward dart-level goals (skips edited + bot). */
export function eligibleDarts(turn: Turn): DartThrow[] {
  if (!isEligibleVisit(turn)) return [];
  return turn.darts.filter((d) => !d.edited && d.source !== "bot");
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function applyStack(stack: ChallengeStack, occurrences: number, pointsEach: number): number {
  if (occurrences <= 0) return 0;
  if (stack === "once") return pointsEach;
  return pointsEach * occurrences;
}

function credit(
  goal: ChallengeGoalDef,
  occurrences: number,
  evidence?: unknown
): ChallengeCredit | null {
  if (occurrences <= 0) return null;
  const points = applyStack(goal.stack, occurrences, goal.points);
  if (points <= 0) return null;
  return {
    goalId: goal.id,
    points,
    occurrences: goal.stack === "once" ? 1 : occurrences,
    ...(evidence !== undefined ? { evidence } : {}),
  };
}

/**
 * `bull` — count inner bulls (`kind === "bull"`).
 * Params:
 * - `includeOuter?: boolean` — also count `outer_bull` (default false)
 * - `count?: number` — when set, award in groups of N hits
 *   - stack `every`: occurrences = floor(hits / count)
 *   - stack `once`: occurrences = 1 if hits >= count
 * - when `count` omitted: each hit is one occurrence (once → any hit awards once)
 */
function evalBull(goal: ChallengeGoalDef, turns: Turn[]): ChallengeCredit | null {
  const includeOuter = asBool(goal.params.includeOuter, false);
  const group = goal.params.count != null ? asNumber(goal.params.count, 0) : null;
  let hits = 0;
  for (const turn of turns) {
    for (const d of eligibleDarts(turn)) {
      if (d.kind === "bull") hits += 1;
      else if (includeOuter && d.kind === "outer_bull") hits += 1;
    }
  }
  let occurrences: number;
  if (group != null && group > 0) {
    occurrences =
      goal.stack === "once" ? (hits >= group ? 1 : 0) : Math.floor(hits / group);
  } else {
    occurrences = goal.stack === "once" ? (hits > 0 ? 1 : 0) : hits;
  }
  return credit(goal, occurrences, { hits });
}

/**
 * `checkout_min` — checkout visit with visit value >= min.
 * Params: `{ min: number, requireDoubleOut?: boolean }`
 * When requireDoubleOut, last dart must be double or bull.
 */
function evalCheckoutMin(
  goal: ChallengeGoalDef,
  turns: Turn[],
  mode: GameState["mode"]
): ChallengeCredit | null {
  const min = asNumber(goal.params.min, 0);
  const requireDoubleOut = asBool(goal.params.requireDoubleOut, false);
  let n = 0;
  for (const turn of turns) {
    if (!isEligibleVisit(turn) || !turn.checkout || turn.bust) continue;
    const value = visitPointsFromTurn(mode, turn);
    if (value < min) continue;
    if (requireDoubleOut) {
      const last = turn.darts[turn.darts.length - 1];
      if (!last || (last.kind !== "double" && last.kind !== "bull")) continue;
    }
    n += 1;
  }
  const occurrences = goal.stack === "once" ? (n > 0 ? 1 : 0) : n;
  return credit(goal, occurrences, { checkouts: n });
}

/** `visit_score` — non-bust visit total >= min */
function evalVisitScore(
  goal: ChallengeGoalDef,
  turns: Turn[],
  mode: GameState["mode"]
): ChallengeCredit | null {
  const min = asNumber(goal.params.min, 0);
  let n = 0;
  for (const turn of turns) {
    if (!isEligibleVisit(turn) || turn.bust) continue;
    if (visitPointsFromTurn(mode, turn) >= min) n += 1;
  }
  const occurrences = goal.stack === "once" ? (n > 0 ? 1 : 0) : n;
  return credit(goal, occurrences);
}

/** `one_eighty` — visit total === 180 */
function evalOneEighty(
  goal: ChallengeGoalDef,
  turns: Turn[],
  mode: GameState["mode"]
): ChallengeCredit | null {
  let n = 0;
  for (const turn of turns) {
    if (!isEligibleVisit(turn) || turn.bust) continue;
    if (visitPointsFromTurn(mode, turn) === 180) n += 1;
  }
  const occurrences = goal.stack === "once" ? (n > 0 ? 1 : 0) : n;
  return credit(goal, occurrences);
}

/**
 * `segment_hit` — hits of kind + number.
 * Params: `{ kind: SegmentKind, number?: number }`
 * For bull/outer_bull/miss, `number` is ignored.
 */
function evalSegmentHit(goal: ChallengeGoalDef, turns: Turn[]): ChallengeCredit | null {
  const kind = goal.params.kind as SegmentKind | undefined;
  if (!kind) return null;
  const number = goal.params.number != null ? asNumber(goal.params.number, 0) : null;
  let hits = 0;
  for (const turn of turns) {
    for (const d of eligibleDarts(turn)) {
      if (d.kind !== kind) continue;
      if (
        kind === "bull" ||
        kind === "outer_bull" ||
        kind === "miss" ||
        number == null ||
        d.number === number
      ) {
        hits += 1;
      }
    }
  }
  const occurrences = goal.stack === "once" ? (hits > 0 ? 1 : 0) : hits;
  return credit(goal, occurrences, { hits });
}

/** `match_win` — player is winnerId */
function evalMatchWin(goal: ChallengeGoalDef, state: GameState, playerId: string): ChallengeCredit | null {
  const won = state.winnerId === playerId ? 1 : 0;
  return credit(goal, won);
}

/** `legs_won` — count from playerStates.legsWon when available */
function evalLegsWon(goal: ChallengeGoalDef, state: GameState, playerId: string): ChallengeCredit | null {
  const ps = state.playerStates.find((p) => p.playerId === playerId);
  const legs = ps?.legsWon ?? 0;
  const occurrences = goal.stack === "once" ? (legs > 0 ? 1 : 0) : legs;
  return credit(goal, occurrences, { legs });
}

/**
 * Evaluate all goals for one registered player against final match state.
 * Callers must ensure the player is a registered PIN account (not guest/bot).
 */
export function evaluateChallengeGoals(
  state: GameState,
  playerId: string,
  goals: ChallengeGoalDef[]
): ChallengeCredit[] {
  const playerTurns = state.turns.filter((t) => t.playerId === playerId);
  const out: ChallengeCredit[] = [];

  for (const goal of goals) {
    let c: ChallengeCredit | null = null;
    switch (goal.ruleType) {
      case "bull":
        c = evalBull(goal, playerTurns);
        break;
      case "checkout_min":
        c = evalCheckoutMin(goal, playerTurns, state.mode);
        break;
      case "visit_score":
        c = evalVisitScore(goal, playerTurns, state.mode);
        break;
      case "one_eighty":
        c = evalOneEighty(goal, playerTurns, state.mode);
        break;
      case "segment_hit":
        c = evalSegmentHit(goal, playerTurns);
        break;
      case "match_win":
        c = evalMatchWin(goal, state, playerId);
        break;
      case "legs_won":
        c = evalLegsWon(goal, state, playerId);
        break;
      default:
        c = null;
    }
    if (c) out.push(c);
  }
  return out;
}

export function sumCreditPoints(credits: ChallengeCredit[]): number {
  return credits.reduce((a, c) => a + c.points, 0);
}
