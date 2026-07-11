/**
 * Around the Clock / Around the World – hit 1 through 20 (optional bull) in order.
 */

import { isDouble, segmentLabel } from "../dart";
import type { ApplyDartResult, DartThrow, EngineEvent, GameState } from "../types";
import { advanceThrower, getTeamForPlayer, syncTeamSharedState } from "../teams";
import {
  cloneState,
  createEmptyPlayerState,
  currentPlayer,
  currentPlayerState,
  getModeConfig,
  type GameModeHandler,
} from "./base";

function finalTarget(state: GameState): number {
  const cfg = getModeConfig(state, "around_the_clock");
  return cfg.includeBull ? 21 : 20; // 21 represents bull
}

function matchesTarget(dart: DartThrow, target: number, requireDouble: boolean): boolean {
  if (target === 21) {
    if (requireDouble) return dart.kind === "bull";
    return dart.kind === "bull" || dart.kind === "outer_bull";
  }
  if (dart.number !== target) return false;
  if (requireDouble) return isDouble(dart) || dart.kind === "double";
  return dart.kind === "single" || dart.kind === "double" || dart.kind === "triple";
}

export const aroundTheClockHandler: GameModeHandler = {
  id: "around_the_clock",
  displayName: "Around the Clock",
  description: "Hit numbers 1–20 in order",

  initLeg(state: GameState): GameState {
    const cfg = getModeConfig(state, "around_the_clock");
    const next = cloneState(state);
    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const base = createEmptyPlayerState(p, 0);
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
      }
      base.nextTarget = cfg.direction === "up" ? 1 : 20;
      base.score = 0; // progress display
      return base;
    });
    next.currentTurnDarts = [];
    next.legWinnerId = null;
    next.status = "playing";
    return next;
  },

  applyDart(state: GameState, dart: DartThrow): ApplyDartResult {
    const cfg = getModeConfig(state, "around_the_clock");
    const next = cloneState(state);
    const events: EngineEvent[] = [{ type: "dart", payload: dart, timestamp: Date.now() }];
    const ps = currentPlayerState(next);
    const player = currentPlayer(next);

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;

    const target = ps.nextTarget ?? 1;
    if (matchesTarget(dart, target, cfg.requireDouble)) {
      if (target === finalTarget(next)) {
        // Won
        ps.nextTarget = target + 1;
        ps.score = target;
        next.legWinnerId = player.id;
        ps.legsWon += 1;
        next.status = "leg_won";
        const turn = {
          playerId: player.id,
          darts: [...next.currentTurnDarts],
          startScore: 0,
          endScore: target,
          bust: false,
          checkout: true,
          timestamp: Date.now(),
        };
        next.turns.push(turn);
        next.currentTurnDarts = [];
        next.legWinnerTeamId = getTeamForPlayer(next, player.id)?.id ?? null;
        syncTeamSharedState(next, player.id);
        events.push({ type: "leg_won", payload: { playerId: player.id }, timestamp: Date.now() });
        if (ps.legsWon >= next.matchFormat.legsToWin) {
          ps.setsWon += 1;
          syncTeamSharedState(next, player.id);
          if (ps.setsWon >= next.matchFormat.setsToWin) {
            next.status = "match_won";
            next.winnerId = player.id;
            next.winnerTeamId = getTeamForPlayer(next, player.id)?.id ?? null;
          }
        }
        return { state: next, events, callout: "GAME SHOT" };
      }

      // Advance target
      if (cfg.direction === "up") {
        if (target === 20 && cfg.includeBull) ps.nextTarget = 21;
        else ps.nextTarget = target + 1;
      } else {
        if (target === 1 && cfg.includeBull) ps.nextTarget = 21;
        else if (target === 21) ps.nextTarget = 22;
        else ps.nextTarget = target - 1;
      }
      ps.score = typeof ps.nextTarget === "number" ? ps.nextTarget - 1 : target;
      syncTeamSharedState(next, player.id);
    }

    return {
      state: next,
      events,
      callout: segmentLabel(dart.kind, dart.number),
    };
  },

  shouldEndTurn(state: GameState): boolean {
    return state.status === "playing" && state.currentTurnDarts.length >= 3;
  },

  getStatusLine(state: GameState): string {
    const ps = currentPlayerState(state);
    const t = ps.nextTarget === 21 ? "BULL" : String(ps.nextTarget);
    return `Around the Clock · Next: ${t}`;
  },
};

export function finalizeAroundTurn(state: GameState): ApplyDartResult {
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.currentTurnDarts.length === 0) return { state: next, events };
  const player = currentPlayer(next);
  const ps = currentPlayerState(next);
  const turn = {
    playerId: player.id,
    darts: [...next.currentTurnDarts],
    startScore: 0,
    endScore: ps.nextTarget ?? 0,
    bust: false,
    checkout: false,
    timestamp: Date.now(),
  };
  next.turns.push(turn);
  next.currentTurnDarts = [];
  advanceThrower(next);
  events.push({ type: "turn_end", payload: turn, timestamp: Date.now() });
  return { state: next, events };
}
