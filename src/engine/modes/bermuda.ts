/**
 * Bermuda Triangle – fixed target sequence; miss all three = lose round points.
 * Classic targets: 12, 13, 14, Doubles, 15, 16, 17, Triples, 18, 19, 20, Bull, DBull
 */

import { segmentLabel } from "../dart";
import type { ApplyDartResult, DartThrow, EngineEvent, GameState, SegmentKind } from "../types";
import { advanceThrower, syncTeamSharedState } from "../teams";
import {
  cloneState,
  createEmptyPlayerState,
  currentPlayer,
  currentPlayerState,
  type GameModeHandler,
} from "./base";

export type BermudaTarget =
  | { type: "number"; n: number }
  | { type: "any_double" }
  | { type: "any_triple" }
  | { type: "bull" }
  | { type: "double_bull" };

export const BERMUDA_SEQUENCE: BermudaTarget[] = [
  { type: "number", n: 12 },
  { type: "number", n: 13 },
  { type: "number", n: 14 },
  { type: "any_double" },
  { type: "number", n: 15 },
  { type: "number", n: 16 },
  { type: "number", n: 17 },
  { type: "any_triple" },
  { type: "number", n: 18 },
  { type: "number", n: 19 },
  { type: "number", n: 20 },
  { type: "bull" },
  { type: "double_bull" },
];

export function bermudaTargetLabel(t: BermudaTarget): string {
  switch (t.type) {
    case "number":
      return String(t.n);
    case "any_double":
      return "DOUBLES";
    case "any_triple":
      return "TRIPLES";
    case "bull":
      return "25 / BULL";
    case "double_bull":
      return "BULLSEYE";
  }
}

function dartScoresTarget(dart: DartThrow, t: BermudaTarget): number {
  switch (t.type) {
    case "number":
      if (dart.number === t.n && (dart.kind === "single" || dart.kind === "double" || dart.kind === "triple")) {
        return dart.value;
      }
      return 0;
    case "any_double":
      return dart.kind === "double" || dart.kind === "bull" ? dart.value : 0;
    case "any_triple":
      return dart.kind === "triple" ? dart.value : 0;
    case "bull":
      if (dart.kind === "outer_bull") return 25;
      if (dart.kind === "bull") return 50;
      return 0;
    case "double_bull":
      return dart.kind === "bull" ? 50 : 0;
  }
}

export const bermudaHandler: GameModeHandler = {
  id: "bermuda",
  displayName: "Bermuda",
  description: "Hit the round target or lose your points for the round",

  initLeg(state: GameState): GameState {
    const next = cloneState(state);
    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const base = createEmptyPlayerState(p, 0);
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
      }
      base.extra = { roundPoints: 0 };
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
    const target = BERMUDA_SEQUENCE[next.roundIndex] ?? BERMUDA_SEQUENCE[0];

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;

    const gained = dartScoresTarget(dart, target);
    const rp = Number(ps.extra?.roundPoints ?? 0) + gained;
    ps.extra = { ...ps.extra, roundPoints: rp };

    return { state: next, events, callout: segmentLabel(dart.kind, dart.number) };
  },

  shouldEndTurn(state: GameState): boolean {
    return state.status === "playing" && state.currentTurnDarts.length >= 3;
  },

  getStatusLine(state: GameState): string {
    const t = BERMUDA_SEQUENCE[state.roundIndex];
    return `Bermuda · ${t ? bermudaTargetLabel(t) : "—"}`;
  },
};

export function finalizeBermudaTurn(state: GameState): ApplyDartResult {
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.currentTurnDarts.length === 0) return { state: next, events };

  const player = currentPlayer(next);
  const ps = currentPlayerState(next);
  const roundPoints = Number(ps.extra?.roundPoints ?? 0);

  // Miss all three ⇒ lose the points scored this round (or all if classic variant)
  // Classic: if zero hits, subtract the sum you would have... actually classic Bermuda:
  // points scored on target are added; if you score 0 on the round, you LOSE the points
  // equal to what? Usually: score 0 → your total becomes total - points that round (0)
  // Actually standard Bermuda: if you hit nothing, you lose ALL points accumulated for that visit
  // which is 0, OR some rules: forfeit points equal to the target value * something.
  // Common pub rule: miss the target with all 3 darts → score is reduced by the points
  // you had gained earlier in the game for that "island" — simpler rule we use:
  // If roundPoints === 0, subtract 10 * round number or the target face value.
  let delta = roundPoints;
  if (roundPoints === 0) {
    const t = BERMUDA_SEQUENCE[next.roundIndex];
    const penalty =
      t?.type === "number" ? t.n * 3 : t?.type === "any_double" ? 40 : t?.type === "any_triple" ? 60 : 50;
    delta = -penalty;
  }
  ps.score = Math.max(0, ps.score + delta);
  if (delta > 0) ps.totalScore += delta;
  ps.extra = { ...ps.extra, roundPoints: 0 };

  const turn = {
    playerId: player.id,
    darts: [...next.currentTurnDarts],
    startScore: ps.score - Math.max(0, delta),
    endScore: ps.score,
    bust: delta < 0,
    checkout: false,
    timestamp: Date.now(),
  };
  next.turns.push(turn);
  next.currentTurnDarts = [];

  syncTeamSharedState(next, player.id);
  const wrapped = advanceThrower(next);
  if (wrapped) {
    next.roundIndex += 1;
    if (next.roundIndex >= BERMUDA_SEQUENCE.length) {
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
      return { state: next, events, callout: delta < 0 ? "PENALTY" : "FINAL" };
    }
  }
  events.push({ type: "turn_end", payload: turn, timestamp: Date.now() });
  return {
    state: next,
    events,
    callout: delta < 0 ? "MISS – PENALTY" : delta > 0 ? `+${delta}` : undefined,
  };
}

// silence unused import in case
void (0 as unknown as SegmentKind);
