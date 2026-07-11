/**
 * Cricket – standard (points after close) and cut-throat variants.
 */

import { cricketMarks, cricketNumber, segmentLabel } from "../dart";
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

const DEFAULT_NUMBERS = [20, 19, 18, 17, 16, 15, 25];

function numbers(state: GameState): number[] {
  const cfg = getModeConfig(state, "cricket");
  return cfg.numbers ?? DEFAULT_NUMBERS;
}

function allClosed(ps: { marks?: Record<number, number> }, nums: number[]): boolean {
  return nums.every((n) => (ps.marks?.[n] ?? 0) >= 3);
}

export const cricketHandler: GameModeHandler = {
  id: "cricket",
  displayName: "Cricket",
  description: "Standard & cut-throat cricket",

  initLeg(state: GameState): GameState {
    const next = cloneState(state);
    const nums = numbers(next);
    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const base = createEmptyPlayerState(p, 0);
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
      }
      base.marks = Object.fromEntries(nums.map((n) => [n, 0]));
      return base;
    });
    next.currentTurnDarts = [];
    next.legWinnerId = null;
    next.status = "playing";
    return next;
  },

  applyDart(state: GameState, dart: DartThrow): ApplyDartResult {
    const cfg = getModeConfig(state, "cricket");
    const next = cloneState(state);
    const events: EngineEvent[] = [{ type: "dart", payload: dart, timestamp: Date.now() }];
    const ps = currentPlayerState(next);
    const player = currentPlayer(next);
    const nums = numbers(next);

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;

    const num = cricketNumber(dart);
    if (num !== null && nums.includes(num)) {
      const marks = cricketMarks(dart);
      const current = ps.marks![num] ?? 0;

      if (current >= 3) {
        applyScoring(next, player.id, num, marks, cfg.variant);
      } else {
        const newMarks = current + marks;
        if (newMarks <= 3) {
          ps.marks![num] = newMarks;
        } else {
          ps.marks![num] = 3;
          applyScoring(next, player.id, num, newMarks - 3, cfg.variant);
        }
      }
      syncTeamSharedState(next, player.id);
    }

    // Win check after each dart if all closed and (standard: leading points / cutthroat: lowest)
    if (allClosed(ps, nums)) {
      const won = checkCricketWin(next, player.id, cfg.variant, nums);
      if (won) {
        const turn = {
          playerId: player.id,
          darts: [...next.currentTurnDarts],
          startScore: 0,
          endScore: ps.score,
          bust: false,
          checkout: true,
          timestamp: Date.now(),
        };
        next.turns.push(turn);
        next.currentTurnDarts = [];
        next.legWinnerId = player.id;
        next.legWinnerTeamId = getTeamForPlayer(next, player.id)?.id ?? null;
        ps.legsWon += 1;
        syncTeamSharedState(next, player.id);
        next.status = "leg_won";
        events.push({ type: "leg_won", payload: { playerId: player.id }, timestamp: Date.now() });
        if (ps.legsWon >= next.matchFormat.legsToWin) {
          ps.setsWon += 1;
          syncTeamSharedState(next, player.id);
          if (ps.setsWon >= next.matchFormat.setsToWin) {
            next.status = "match_won";
            next.winnerId = player.id;
            next.winnerTeamId = getTeamForPlayer(next, player.id)?.id ?? null;
            events.push({ type: "match_won", payload: { playerId: player.id }, timestamp: Date.now() });
          }
        }
        return { state: next, events, callout: "GAME SHOT" };
      }
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
    const cfg = getModeConfig(state, "cricket");
    return `Cricket · ${cfg.variant === "cutthroat" ? "Cut-Throat" : "Standard"}`;
  },
};

function sameTeam(state: GameState, a: string, b: string): boolean {
  const ta = getTeamForPlayer(state, a)?.id;
  const tb = getTeamForPlayer(state, b)?.id;
  return Boolean(ta && tb && ta === tb);
}

function applyScoring(
  state: GameState,
  throwerId: string,
  num: number,
  excessMarks: number,
  variant: "standard" | "cutthroat"
) {
  if (excessMarks <= 0) return;
  const points = num * excessMarks;
  if (variant === "standard") {
    const thrower = state.playerStates.find((p) => p.playerId === throwerId)!;
    if ((thrower.marks?.[num] ?? 0) >= 3 && anyoneOpenExcept(state, num, throwerId)) {
      thrower.score += points;
      thrower.totalScore += points;
      syncTeamSharedState(state, throwerId);
    }
  } else {
    // Cut-throat: points to opposing teams that haven't closed
    const hitTeams = new Set<string>();
    for (const p of state.playerStates) {
      if (sameTeam(state, p.playerId, throwerId)) continue;
      if ((p.marks?.[num] ?? 0) < 3) {
        const tid = getTeamForPlayer(state, p.playerId)?.id ?? p.playerId;
        if (hitTeams.has(tid)) continue;
        hitTeams.add(tid);
        p.score += points;
        // only add totalScore to this player once (not partner)
        p.totalScore += points;
        syncTeamSharedState(state, p.playerId);
      }
    }
  }
}

function anyoneOpenExcept(state: GameState, num: number, exceptId: string): boolean {
  return state.playerStates.some(
    (p) => !sameTeam(state, p.playerId, exceptId) && (p.marks?.[num] ?? 0) < 3
  );
}

function checkCricketWin(
  state: GameState,
  playerId: string,
  variant: "standard" | "cutthroat",
  nums: number[]
): boolean {
  const me = state.playerStates.find((p) => p.playerId === playerId)!;
  if (!allClosed(me, nums)) return false;
  // Compare against other teams only
  if (variant === "standard") {
    return state.playerStates.every(
      (p) => sameTeam(state, p.playerId, playerId) || p.score <= me.score
    );
  }
  return state.playerStates.every(
    (p) => sameTeam(state, p.playerId, playerId) || p.score >= me.score
  );
}

export function finalizeCricketTurn(state: GameState): ApplyDartResult {
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.currentTurnDarts.length === 0) return { state: next, events };
  const player = currentPlayer(next);
  const ps = currentPlayerState(next);
  const turn = {
    playerId: player.id,
    darts: [...next.currentTurnDarts],
    startScore: 0,
    endScore: ps.score,
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
