/**
 * Count-Up – highest score after fixed number of turns wins.
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

export const countUpHandler: GameModeHandler = {
  id: "countup",
  displayName: "Count-Up",
  description: "Highest score after fixed turns wins",

  initLeg(state: GameState): GameState {
    const next = cloneState(state);
    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const base = createEmptyPlayerState(p, 0);
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
      }
      base.extra = { turnsPlayed: 0 };
      return base;
    });
    next.currentTurnDarts = [];
    next.legWinnerId = null;
    next.status = "playing";
    next.roundIndex = 0;
    return next;
  },

  applyDart(state: GameState, dart: DartThrow): ApplyDartResult {
    const next = cloneState(state);
    const events: EngineEvent[] = [{ type: "dart", payload: dart, timestamp: Date.now() }];
    const ps = currentPlayerState(next);

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;
    ps.score += dart.value;
    ps.totalScore += dart.value;
    syncTeamSharedState(next, ps.playerId);

    return { state: next, events, callout: segmentLabel(dart.kind, dart.number) };
  },

  shouldEndTurn(state: GameState): boolean {
    return state.status === "playing" && state.currentTurnDarts.length >= 3;
  },

  getStatusLine(state: GameState): string {
    const cfg = getModeConfig(state, "countup");
    return `Count-Up · ${cfg.turns} turns`;
  },
};

export function finalizeCountUpTurn(state: GameState): ApplyDartResult {
  const cfg = getModeConfig(state, "countup");
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.currentTurnDarts.length === 0) return { state: next, events };

  const player = currentPlayer(next);
  const ps = currentPlayerState(next);
  const turnTotal = next.currentTurnDarts.reduce((a, d) => a + d.value, 0);
  if (turnTotal === 180) ps.oneEighties += 1;

  const turnsPlayed = Number(ps.extra?.turnsPlayed ?? 0) + 1;
  ps.extra = { ...ps.extra, turnsPlayed };

  const turn = {
    playerId: player.id,
    darts: [...next.currentTurnDarts],
    startScore: ps.score - turnTotal,
    endScore: ps.score,
    bust: false,
    checkout: false,
    timestamp: Date.now(),
  };
  next.turns.push(turn);
  next.currentTurnDarts = [];
  syncTeamSharedState(next, player.id);
  advanceThrower(next);
  events.push({ type: "turn_end", payload: turn, timestamp: Date.now() });

  // Game over when every player has finished their turns
  const allDone = next.playerStates.every((p) => Number(p.extra?.turnsPlayed ?? 0) >= cfg.turns);
  if (allDone) {
    const seen = new Set<string>();
    const leaders = next.playerStates.filter((p) => {
      const tid = p.teamId ?? p.playerId;
      if (seen.has(tid)) return false;
      seen.add(tid);
      return true;
    });
    const sorted = [...leaders].sort((a, b) => b.score - a.score);
    next.legWinnerId = sorted[0].playerId;
    sorted[0].legsWon += 1;
    syncTeamSharedState(next, sorted[0].playerId);
    next.status = "leg_won";
    events.push({ type: "leg_won", payload: { playerId: sorted[0].playerId }, timestamp: Date.now() });
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

  return {
    state: next,
    events,
    callout: turnTotal === 180 ? "180!" : turnTotal >= 100 ? String(turnTotal) : undefined,
  };
}
