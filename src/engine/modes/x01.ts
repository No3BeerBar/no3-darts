/**
 * X01 mode – 301 / 501 / 701 / 901 with optional double-in / double-out.
 */

import { createDart, isDouble, segmentLabel } from "../dart";
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

function sumDarts(darts: DartThrow[]): number {
  return darts.reduce((a, d) => a + d.value, 0);
}

export const x01Handler: GameModeHandler = {
  id: "x01",
  displayName: "X01",
  description: "Classic countdown – 301, 501, 701, 901",

  initLeg(state: GameState): GameState {
    const cfg = getModeConfig(state, "x01");
    const next = cloneState(state);
    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const team = next.teams?.find((t) => t.playerIds.includes(p.id));
      const base = createEmptyPlayerState(p, cfg.startScore, team?.id ?? prev?.teamId);
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
        base.teamId = prev.teamId ?? team?.id;
      }
      base.hasOpened = !cfg.doubleIn;
      return base;
    });
    // Sync team shared score at leg start
    for (const t of next.teams ?? []) {
      if (t.playerIds[0]) syncTeamSharedState(next, t.playerIds[0]);
    }
    next.currentTurnDarts = [];
    next.legWinnerId = null;
    next.legWinnerTeamId = null;
    next.status = "playing";
    next.roundIndex = 0;
    return next;
  },

  applyDart(state: GameState, dart: DartThrow): ApplyDartResult {
    const cfg = getModeConfig(state, "x01");
    const next = cloneState(state);
    const events: EngineEvent[] = [{ type: "dart", payload: dart, timestamp: Date.now() }];
    const ps = currentPlayerState(next);
    const player = currentPlayer(next);

    // Double-in
    if (!ps.hasOpened) {
      if (isDouble(dart)) {
        ps.hasOpened = true;
      } else {
        // Dart counts as thrown but no score
        next.currentTurnDarts.push(dart);
        ps.dartsThrown += 1;
        syncTeamSharedState(next, player.id);
        return {
          state: next,
          events,
          callout: `${segmentLabel(dart.kind, dart.number)} – need double in`,
        };
      }
      syncTeamSharedState(next, player.id);
    }

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;

    const turnTotal = sumDarts(next.currentTurnDarts);
    const provisional = ps.score - turnTotal;

    // Bust rules
    let bust = false;
    if (provisional < 0) bust = true;
    if (provisional === 1 && cfg.doubleOut) bust = true; // cannot leave 1 on double-out
    if (provisional === 0 && cfg.doubleOut && !isDouble(dart)) bust = true;

    if (bust) {
      events.push({ type: "bust", timestamp: Date.now() });
      // Revert turn – score unchanged; still record turn
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
      advanceThrower(next);
      events.push({ type: "turn_end", payload: turn, timestamp: Date.now() });
      return { state: next, events, callout: "BUST" };
    }

    // Checkout success
    if (provisional === 0) {
      const startScore = ps.score;
      ps.score = 0;
      ps.totalScore += turnTotal;
      ps.checkoutsHit += 1;
      ps.checkoutAttempts += 1;
      if (turnTotal > ps.highestCheckout) ps.highestCheckout = turnTotal;
      if (turnTotal === 180) ps.oneEighties += 1;
      updateFirst9(ps, next.currentTurnDarts, startScore, cfg.startScore);

      const turn = {
        playerId: player.id,
        darts: [...next.currentTurnDarts],
        startScore,
        endScore: 0,
        bust: false,
        checkout: true,
        timestamp: Date.now(),
      };
      next.turns.push(turn);
      next.currentTurnDarts = [];
      next.legWinnerId = player.id;
      const team = getTeamForPlayer(next, player.id);
      next.legWinnerTeamId = team?.id ?? null;
      ps.legsWon += 1;
      syncTeamSharedState(next, player.id);
      next.status = "leg_won";
      events.push({
        type: "leg_won",
        payload: { playerId: player.id, teamId: team?.id },
        timestamp: Date.now(),
      });

      // Sets / match — team legs
      const format = next.matchFormat;
      if (ps.legsWon >= format.legsToWin) {
        ps.setsWon += 1;
        ps.legsWon = 0;
        syncTeamSharedState(next, player.id);
        events.push({ type: "set_won", payload: { playerId: player.id }, timestamp: Date.now() });
        if (ps.setsWon >= format.setsToWin) {
          next.status = "match_won";
          next.winnerId = player.id;
          next.winnerTeamId = team?.id ?? null;
          events.push({ type: "match_won", payload: { playerId: player.id }, timestamp: Date.now() });
          return { state: next, events, callout: "GAME SHOT – MATCH" };
        }
      }
      return { state: next, events, callout: "GAME SHOT" };
    }

    // Checkout attempt tracking (when remaining was ≤ 170 at start of dart)
    const remainingBefore = ps.score - sumDarts(next.currentTurnDarts.slice(0, -1));
    if (remainingBefore <= 170 && remainingBefore >= 2 && cfg.doubleOut) {
      // only count once per turn ideally – counted on visit when ending
    }

    // Normal dart – score only applied at end of turn for classic feel,
    // but we show provisional. We keep score as start-of-turn until turn ends,
    // except we track provisional via currentTurnDarts.
    // For first9 / stats we apply on turn end.

    let callout = segmentLabel(dart.kind, dart.number);
    const partial = sumDarts(next.currentTurnDarts);
    if (next.currentTurnDarts.length === 3 && partial === 180) {
      callout = "180!";
    }

    return { state: next, events, callout };
  },

  shouldEndTurn(state: GameState): boolean {
    if (state.status !== "playing") return false;
    if (state.currentTurnDarts.length >= 3) return true;
    // Bust already ended turn in applyDart
    return false;
  },

  getRemaining(state: GameState, playerId: string): number {
    const ps = state.playerStates.find((p) => p.playerId === playerId);
    if (!ps) return 0;
    const currentId = state.players[state.currentPlayerIndex]?.id;
    const teamOf = (id: string) => getTeamForPlayer(state, id)?.id;
    const activeTeam = currentId ? teamOf(currentId) : null;
    const thisTeam = teamOf(playerId);
    const onActiveTeam = Boolean(activeTeam && thisTeam && activeTeam === thisTeam);
    const used = onActiveTeam
      ? state.currentTurnDarts.reduce((a, d) => a + d.value, 0)
      : 0;
    if (!ps.hasOpened && getModeConfig(state, "x01").doubleIn) return ps.score;
    return Math.max(0, ps.score - used);
  },

  getStatusLine(state: GameState): string {
    const cfg = getModeConfig(state, "x01");
    const inOut = `${cfg.doubleIn ? "DI" : "SI"} / ${cfg.doubleOut ? "DO" : "SO"}`;
    const doubles = state.teams?.some((t) => t.playerIds.length > 1) ? " · Doubles" : "";
    return `${cfg.startScore} · ${inOut}${doubles}`;
  },
};

function updateFirst9(
  ps: { first9Total: number; first9Darts: number; totalScore: number },
  darts: DartThrow[],
  startScore: number,
  gameStart: number
) {
  // Approximate: if still early in leg (start score close to game start)
  const thrownBefore = ps.first9Darts; // we track first9 darts separately
  if (thrownBefore >= 9) return;
  const room = 9 - thrownBefore;
  const take = darts.slice(0, room);
  const pts = take.reduce((a, d) => a + d.value, 0);
  // only if scoring from near start
  if (startScore >= gameStart - 180) {
    ps.first9Total += pts;
    ps.first9Darts += take.length;
  }
  void startScore;
}

/** Finalize a non-bust, non-checkout 3-dart turn (or early end) */
export function finalizeX01Turn(state: GameState): ApplyDartResult {
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.currentTurnDarts.length === 0) {
    return { state: next, events };
  }

  const cfg = getModeConfig(next, "x01");
  const ps = currentPlayerState(next);
  const player = currentPlayer(next);
  const turnTotal = sumDarts(next.currentTurnDarts);
  const startScore = ps.score;

  // If never opened, no score
  if (!ps.hasOpened && cfg.doubleIn) {
    const turn = {
      playerId: player.id,
      darts: [...next.currentTurnDarts],
      startScore,
      endScore: startScore,
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

  ps.score = startScore - turnTotal;
  ps.totalScore += turnTotal;
  if (turnTotal === 180) ps.oneEighties += 1;
  if (startScore <= 170) ps.checkoutAttempts += 1;
  updateFirst9(ps, next.currentTurnDarts, startScore, cfg.startScore);
  syncTeamSharedState(next, player.id);

  const turn = {
    playerId: player.id,
    darts: [...next.currentTurnDarts],
    startScore,
    endScore: ps.score,
    bust: false,
    checkout: false,
    timestamp: Date.now(),
  };
  next.turns.push(turn);
  next.currentTurnDarts = [];
  advanceThrower(next);
  events.push({ type: "turn_end", payload: turn, timestamp: Date.now() });

  let callout: string | undefined;
  if (turnTotal === 180) callout = "180!";
  else if (turnTotal >= 140) callout = String(turnTotal);

  return { state: next, events, callout };
}

/** Helper to create a miss dart for skip */
export function missDart(): DartThrow {
  return createDart("miss", 0);
}
