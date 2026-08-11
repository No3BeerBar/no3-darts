/**
 * Baseball (John’s rules) – 9 innings.
 * Only hits on the **current inning number** count.
 * Inning N: S/D/T of N → N×1 / N×2 / N×3 (e.g. inning 4 → 4 / 8 / 12).
 * Any other segment, miss, or bull → 0 for that dart.
 * Highest total after 9 innings wins.
 * Ties: same as Shanghai/Count-Up — first among tied high scores wins the leg.
 */

import { segmentLabel } from "../dart";
import type { ApplyDartResult, DartThrow, EngineEvent, GameState } from "../types";
import { advanceThrower, syncTeamSharedState } from "../teams";
import {
  cloneState,
  createEmptyPlayerState,
  currentPlayer,
  currentPlayerState,
  getModeConfig,
  type GameModeHandler,
} from "./base";

export const BASEBALL_INNINGS = 9;

/** Inning number 1–9 from roundIndex (0-based). */
export function baseballInning(state: GameState): number {
  return Math.min(BASEBALL_INNINGS, state.roundIndex + 1);
}

/** Target segment for the current inning. */
export function baseballTarget(state: GameState): number {
  return baseballInning(state);
}

/**
 * Points for one dart in a given inning (1–9).
 * Only S/D/T of that inning number score; everything else is 0.
 * Single N → N×1, Double N → N×2, Triple N → N×3.
 */
export function baseballDartPoints(dart: DartThrow, inning: number): number {
  if (inning < 1 || inning > BASEBALL_INNINGS) return 0;
  // Strict: must be the current inning number (not any other segment / bull / miss)
  if (
    (dart.kind === "single" || dart.kind === "double" || dart.kind === "triple") &&
    dart.number === inning
  ) {
    const mult = dart.kind === "single" ? 1 : dart.kind === "double" ? 2 : 3;
    return inning * mult;
  }
  return 0;
}

export function baseballVisitPoints(darts: DartThrow[], inning: number): number {
  return darts.reduce((sum, d) => sum + baseballDartPoints(d, inning), 0);
}

export const baseballHandler: GameModeHandler = {
  id: "baseball",
  displayName: "Baseball",
  description:
    "9 innings · only the inning number scores · S/D/T = N×1/2/3 · highest total wins",

  initLeg(state: GameState): GameState {
    const next = cloneState(state);
    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const base = createEmptyPlayerState(p, 0);
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
      }
      base.extra = { lastDartPoints: 0 };
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
    const inning = baseballInning(next);
    const points = baseballDartPoints(dart, inning);

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;
    ps.score += points;
    if (points > 0) ps.totalScore += points;
    ps.extra = { ...ps.extra, lastDartPoints: points };
    syncTeamSharedState(next, ps.playerId);

    const label = segmentLabel(dart.kind, dart.number);
    const callout = points > 0 ? `${label} · +${points}` : `${label} · 0`;
    return { state: next, events, callout };
  },

  shouldEndTurn(state: GameState): boolean {
    return state.status === "playing" && state.currentTurnDarts.length >= 3;
  },

  getStatusLine(state: GameState): string {
    const inn = baseballInning(state);
    return `Baseball · Inning ${inn} · Target ${inn}`;
  },
};

export function finalizeBaseballTurn(state: GameState): ApplyDartResult {
  const cfg = getModeConfig(state, "baseball");
  const maxInnings = cfg.innings ?? BASEBALL_INNINGS;
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.currentTurnDarts.length === 0) return { state: next, events };

  const player = currentPlayer(next);
  const ps = currentPlayerState(next);
  const inning = baseballInning(next);
  const visitPts = baseballVisitPoints(next.currentTurnDarts, inning);

  const turn = {
    playerId: player.id,
    darts: [...next.currentTurnDarts],
    startScore: ps.score - visitPts,
    endScore: ps.score,
    bust: false,
    checkout: false,
    timestamp: Date.now(),
  };
  next.turns.push(turn);
  next.currentTurnDarts = [];
  ps.extra = { ...ps.extra, lastDartPoints: 0 };

  syncTeamSharedState(next, player.id);
  const wrapped = advanceThrower(next);
  if (wrapped) {
    next.roundIndex += 1;
    if (next.roundIndex >= maxInnings) {
      // Highest total wins (unique teams via first member)
      const seen = new Set<string>();
      const leaders = next.playerStates.filter((p) => {
        const tid = p.teamId ?? p.playerId;
        if (seen.has(tid)) return false;
        seen.add(tid);
        return true;
      });
      const sorted = [...leaders].sort((a, b) => b.score - a.score);
      // Tie-break: first among equal high scores (same pattern as Shanghai / Count-Up)
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
      return { state: next, events, callout: "FINAL" };
    }
  }
  events.push({ type: "turn_end", payload: turn, timestamp: Date.now() });
  return {
    state: next,
    events,
    callout: visitPts > 0 ? `+${visitPts}` : undefined,
  };
}
