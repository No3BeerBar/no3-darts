/**
 * Shanghai – each round targets that number (round 1 = 1s, …).
 * Shanghai = single + double + triple of the number in one turn.
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

function targetNumber(state: GameState): number {
  return state.roundIndex + 1; // roundIndex 0 => target 1
}

export const shanghaiHandler: GameModeHandler = {
  id: "shanghai",
  displayName: "Shanghai",
  description: "Score on the round number; Shanghai wins instantly",

  initLeg(state: GameState): GameState {
    const next = cloneState(state);
    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const base = createEmptyPlayerState(p, 0);
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
      }
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
    const target = targetNumber(next);

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;

    // Score only if hits target number
    if (
      (dart.kind === "single" || dart.kind === "double" || dart.kind === "triple") &&
      dart.number === target
    ) {
      ps.score += dart.value;
      ps.totalScore += dart.value;
      syncTeamSharedState(next, ps.playerId);
    }

    // Shanghai check: S+D+T of target in same turn
    if (next.currentTurnDarts.length === 3) {
      const kinds = new Set(
        next.currentTurnDarts
          .filter((d) => d.number === target && ["single", "double", "triple"].includes(d.kind))
          .map((d) => d.kind)
      );
      if (kinds.has("single") && kinds.has("double") && kinds.has("triple")) {
        const player = currentPlayer(next);
        next.legWinnerId = player.id;
        ps.legsWon += 1;
        next.status = "leg_won";
        events.push({ type: "leg_won", payload: { playerId: player.id, shanghai: true }, timestamp: Date.now() });
        if (ps.legsWon >= next.matchFormat.legsToWin) {
          ps.setsWon += 1;
          if (ps.setsWon >= next.matchFormat.setsToWin) {
            next.status = "match_won";
            next.winnerId = player.id;
          }
        }
        return { state: next, events, callout: "SHANGHAI!" };
      }
    }

    return { state: next, events, callout: segmentLabel(dart.kind, dart.number) };
  },

  shouldEndTurn(state: GameState): boolean {
    return state.status === "playing" && state.currentTurnDarts.length >= 3;
  },

  getStatusLine(state: GameState): string {
    return `Shanghai · Round ${targetNumber(state)}`;
  },
};

export function finalizeShanghaiTurn(state: GameState): ApplyDartResult {
  const cfg = getModeConfig(state, "shanghai");
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.currentTurnDarts.length === 0) return { state: next, events };

  const player = currentPlayer(next);
  const ps = currentPlayerState(next);
  const turn = {
    playerId: player.id,
    darts: [...next.currentTurnDarts],
    startScore: ps.score,
    endScore: ps.score,
    bust: false,
    checkout: false,
    timestamp: Date.now(),
  };
  next.turns.push(turn);
  next.currentTurnDarts = [];

  // Advance player; after all players, advance round
  syncTeamSharedState(next, player.id);
  const wrapped = advanceThrower(next);
  if (wrapped) {
    next.roundIndex += 1;
    if (next.roundIndex >= cfg.maxRound) {
      // Highest score wins (unique teams via first member)
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
      return { state: next, events, callout: "ROUND OVER" };
    }
  }
  events.push({ type: "turn_end", payload: turn, timestamp: Date.now() });
  return { state: next, events };
}
