/**
 * Random Checkout practice – generate random remaining scores and practice finishes.
 */

import { isDouble, segmentLabel } from "../dart";
import type { ApplyDartResult, DartThrow, EngineEvent, GameState } from "../types";
import { advanceThrower } from "../teams";
import {
  cloneState,
  createEmptyPlayerState,
  currentPlayer,
  currentPlayerState,
  getModeConfig,
  type GameModeHandler,
} from "./base";

/** Valid double-out remainders excluding bogeys */
const BOGEY = new Set([169, 168, 166, 165, 163, 162, 159]);

export function randomCheckoutScore(min: number, max: number): number {
  const lo = Math.max(2, min);
  const hi = Math.min(170, max);
  for (let i = 0; i < 50; i++) {
    const n = Math.floor(Math.random() * (hi - lo + 1)) + lo;
    if (!BOGEY.has(n)) return n;
  }
  return 40;
}

export const randomCheckoutHandler: GameModeHandler = {
  id: "random_checkout",
  displayName: "Random Checkout",
  description: "Practice random finishes",

  initLeg(state: GameState): GameState {
    const cfg = getModeConfig(state, "random_checkout");
    const next = cloneState(state);
    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const base = createEmptyPlayerState(p, randomCheckoutScore(cfg.minScore, cfg.maxScore));
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
        base.checkoutsHit = prev.checkoutsHit;
        base.checkoutAttempts = prev.checkoutAttempts;
      }
      base.extra = {
        attemptsLeft: cfg.attempts,
        attemptsDone: 0,
      };
      return base;
    });
    next.currentTurnDarts = [];
    next.legWinnerId = null;
    next.status = "playing";
    return next;
  },

  applyDart(state: GameState, dart: DartThrow): ApplyDartResult {
    const next = cloneState(state);
    const events: EngineEvent[] = [{ type: "dart", payload: dart, timestamp: Date.now() }];
    const ps = currentPlayerState(next);
    const player = currentPlayer(next);

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;

    const turnTotal = next.currentTurnDarts.reduce((a, d) => a + d.value, 0);
    const provisional = ps.score - turnTotal;

    let bust = provisional < 0 || provisional === 1;
    if (provisional === 0 && !isDouble(dart)) bust = true;

    if (bust) {
      events.push({ type: "bust", timestamp: Date.now() });
      const turn = {
        playerId: player.id,
        darts: [...next.currentTurnDarts],
        startScore: ps.score,
        endScore: ps.score,
        bust: true,
        checkout: false,
        timestamp: Date.now(),
      };
      next.turns.push(turn);
      next.currentTurnDarts = [];
      ps.checkoutAttempts += 1;
      return afterAttempt(next, events, "BUST");
    }

    if (provisional === 0) {
      ps.score = 0;
      ps.checkoutsHit += 1;
      ps.checkoutAttempts += 1;
      const turn = {
        playerId: player.id,
        darts: [...next.currentTurnDarts],
        startScore: ps.score + turnTotal,
        endScore: 0,
        bust: false,
        checkout: true,
        timestamp: Date.now(),
      };
      next.turns.push(turn);
      next.currentTurnDarts = [];
      return afterAttempt(next, events, "CHECKOUT!");
    }

    return { state: next, events, callout: segmentLabel(dart.kind, dart.number) };
  },

  shouldEndTurn(state: GameState): boolean {
    return state.status === "playing" && state.currentTurnDarts.length >= 3;
  },

  getStatusLine(state: GameState): string {
    const ps = currentPlayerState(state);
    return `Checkout Practice · ${ps.score} · Hit ${ps.checkoutsHit}/${ps.checkoutAttempts || 0}`;
  },
};

function afterAttempt(state: GameState, events: EngineEvent[], callout: string): ApplyDartResult {
  const cfg = getModeConfig(state, "random_checkout");
  const next = state;
  const ps = currentPlayerState(next);
  const done = Number(ps.extra?.attemptsDone ?? 0) + 1;
  const left = Number(ps.extra?.attemptsLeft ?? cfg.attempts) - 1;
  ps.extra = { ...ps.extra, attemptsDone: done, attemptsLeft: left };

  if (left <= 0 && next.currentPlayerIndex === next.players.length - 1) {
    // Check if all players done
    const allDone = next.playerStates.every((p) => Number(p.extra?.attemptsLeft ?? 0) <= 0);
    if (allDone) {
      next.status = "match_won";
      const best = [...next.playerStates].sort((a, b) => b.checkoutsHit - a.checkoutsHit)[0];
      next.winnerId = best.playerId;
      events.push({ type: "match_won", payload: { playerId: best.playerId }, timestamp: Date.now() });
      return { state: next, events, callout: "SESSION COMPLETE" };
    }
  }

  // New random score for this player and advance
  if (left > 0) {
    ps.score = randomCheckoutScore(cfg.minScore, cfg.maxScore);
  }
  advanceThrower(next);
  // Skip players with no attempts left
  let guard = 0;
  while (
    Number(currentPlayerState(next).extra?.attemptsLeft ?? 0) <= 0 &&
    guard < next.players.length
  ) {
    advanceThrower(next);
    guard++;
  }

  events.push({ type: "turn_end", timestamp: Date.now() });
  return { state: next, events, callout };
}

export function finalizeRandomCheckoutTurn(state: GameState): ApplyDartResult {
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.currentTurnDarts.length === 0) return { state: next, events };

  const cfg = getModeConfig(next, "random_checkout");
  const ps = currentPlayerState(next);
  const player = currentPlayer(next);
  const turnTotal = next.currentTurnDarts.reduce((a, d) => a + d.value, 0);
  const start = ps.score;
  // Failed checkout attempt (didn't finish in 3)
  ps.checkoutAttempts += 1;
  // Reset score for next attempt – don't keep partial
  ps.score = randomCheckoutScore(cfg.minScore, cfg.maxScore);

  const turn = {
    playerId: player.id,
    darts: [...next.currentTurnDarts],
    startScore: start,
    endScore: start - turnTotal > 1 ? start : start,
    bust: false,
    checkout: false,
    timestamp: Date.now(),
  };
  next.turns.push(turn);
  next.currentTurnDarts = [];

  return afterAttempt(next, events, `${start} missed`);
}
