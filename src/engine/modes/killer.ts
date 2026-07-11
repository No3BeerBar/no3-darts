/**
 * Killer – classic pub elimination game.
 *
 * Setup: each player is assigned a unique number 1–20.
 * Arm: hit the double of your number → you become a Killer.
 * Attack: as a Killer, hit an opponent's double → they lose 1 life.
 * Own double (while Killer): you lose 1 life.
 * Out: 0 lives → eliminated (turns skipped).
 * Win: last player with lives remaining.
 *
 * Only doubles (and not singles/triples/bull) count by default.
 */

import { segmentLabel } from "../dart";
import type { ApplyDartResult, DartThrow, EngineEvent, GameState } from "../types";
import {
  cloneState,
  createEmptyPlayerState,
  currentPlayer,
  currentPlayerState,
  getModeConfig,
  type GameModeHandler,
} from "./base";

export interface KillerExtra {
  killerNumber: number;
  lives: number;
  isKiller: boolean;
  eliminated: boolean;
}

function extra(ps: { extra?: Record<string, unknown> }): KillerExtra {
  return {
    killerNumber: Number(ps.extra?.killerNumber ?? 0),
    lives: Number(ps.extra?.lives ?? 0),
    isKiller: Boolean(ps.extra?.isKiller),
    eliminated: Boolean(ps.extra?.eliminated),
  };
}

function setExtra(
  ps: { extra?: Record<string, unknown>; score: number },
  e: KillerExtra
): void {
  ps.extra = { ...ps.extra, ...e };
  // score field mirrors lives for simple displays
  ps.score = e.lives;
}

function alivePlayers(state: GameState) {
  return state.playerStates.filter((p) => !extra(p).eliminated);
}

function nextAliveIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (!extra(state.playerStates[idx]).eliminated) return idx;
  }
  return fromIndex;
}

function checkWinner(state: GameState, events: EngineEvent[]): ApplyDartResult | null {
  const alive = alivePlayers(state);
  if (alive.length === 1) {
    const winner = alive[0];
    const player = state.players.find((p) => p.id === winner.playerId)!;
    state.legWinnerId = winner.playerId;
    state.winnerId = winner.playerId;
    state.status = "match_won";
    winner.legsWon += 1;
    winner.setsWon += 1;
    events.push({
      type: "match_won",
      payload: { playerId: winner.playerId },
      timestamp: Date.now(),
    });
    return { state, events, callout: `${player.name} WINS` };
  }
  if (alive.length === 0) {
    // mutual destruction – rare; treat as finished no winner
    state.status = "finished";
    return { state, events, callout: "DRAW" };
  }
  return null;
}

export const killerHandler: GameModeHandler = {
  id: "killer",
  displayName: "Killer",
  description: "Arm on your double, eliminate opponents – last life standing",

  initLeg(state: GameState): GameState {
    const cfg = getModeConfig(state, "killer");
    const next = cloneState(state);
    const lives = cfg.lives ?? 3;

    next.playerStates = next.players.map((p) => {
      const prev = next.playerStates.find((s) => s.playerId === p.id);
      const base = createEmptyPlayerState(p, lives);
      if (prev) {
        base.legsWon = prev.legsWon;
        base.setsWon = prev.setsWon;
      }
      const num = cfg.playerNumbers[p.id];
      if (!num || num < 1 || num > 20) {
        throw new Error(`Killer: player ${p.name} needs a number 1–20`);
      }
      setExtra(base, {
        killerNumber: num,
        lives,
        isKiller: false,
        eliminated: false,
      });
      return base;
    });

    // Validate unique numbers
    const nums = next.playerStates.map((p) => extra(p).killerNumber);
    if (new Set(nums).size !== nums.length) {
      throw new Error("Killer: each player must have a unique number");
    }

    next.currentTurnDarts = [];
    next.legWinnerId = null;
    next.winnerId = null;
    next.status = "playing";
    // Ensure current player is alive
    if (extra(next.playerStates[next.currentPlayerIndex]).eliminated) {
      next.currentPlayerIndex = nextAliveIndex(next, next.currentPlayerIndex - 1);
    }
    return next;
  },

  applyDart(state: GameState, dart: DartThrow): ApplyDartResult {
    const next = cloneState(state);
    const events: EngineEvent[] = [{ type: "dart", payload: dart, timestamp: Date.now() }];
    const ps = currentPlayerState(next);
    const player = currentPlayer(next);
    let me = extra(ps);

    if (me.eliminated) {
      return { state: next, events, callout: "Eliminated" };
    }

    next.currentTurnDarts.push(dart);
    ps.dartsThrown += 1;

    let callout = segmentLabel(dart.kind, dart.number);

    // Only doubles of player numbers matter in classic rules
    if (dart.kind === "double" && dart.number >= 1 && dart.number <= 20) {
      const targetNum = dart.number;

      // Arming: not yet killer, hit own double
      if (!me.isKiller && targetNum === me.killerNumber) {
        me = { ...me, isKiller: true };
        setExtra(ps, me);
        callout = "KILLER!";
      } else if (me.isKiller) {
        // Own double while killer → lose a life
        if (targetNum === me.killerNumber) {
          me = loseLife(me);
          setExtra(ps, me);
          callout = me.eliminated ? "SELF OUT!" : "SELF HIT – LIFE LOST";
          if (me.eliminated) {
            events.push({
              type: "leg_won",
              payload: { eliminated: player.id },
              timestamp: Date.now(),
            });
            const win = checkWinner(next, events);
            if (win) {
              // End turn bookkeeping
              next.currentTurnDarts = [];
              return win;
            }
          }
        } else {
          // Opponent double → remove their life
          const victim = next.playerStates.find(
            (p) => extra(p).killerNumber === targetNum && !extra(p).eliminated
          );
          if (victim && victim.playerId !== player.id) {
            let v = extra(victim);
            v = loseLife(v);
            setExtra(victim, v);
            const vName =
              next.players.find((p) => p.id === victim.playerId)?.name ?? "Player";
            callout = v.eliminated ? `${vName} OUT!` : `${vName} – life lost`;
            if (v.eliminated) {
              events.push({
                type: "leg_won",
                payload: { eliminated: victim.playerId },
                timestamp: Date.now(),
              });
              const win = checkWinner(next, events);
              if (win) {
                next.currentTurnDarts = [];
                return win;
              }
            }
          }
        }
      }
    }

    // If thrower just eliminated themselves mid-turn, still allow remaining flow via end turn
    return { state: next, events, callout };
  },

  shouldEndTurn(state: GameState): boolean {
    if (state.status !== "playing") return false;
    if (state.currentTurnDarts.length >= 3) return true;
    // If current player got eliminated mid-turn, end turn early
    const me = extra(currentPlayerState(state));
    return me.eliminated;
  },

  getRemaining(state: GameState, playerId: string): number {
    const ps = state.playerStates.find((p) => p.playerId === playerId);
    return ps ? extra(ps).lives : 0;
  },

  getStatusLine(state: GameState): string {
    const alive = alivePlayers(state).length;
    const killers = state.playerStates.filter((p) => extra(p).isKiller && !extra(p).eliminated)
      .length;
    return `Killer · ${alive} alive · ${killers} armed`;
  },
};

function loseLife(e: KillerExtra): KillerExtra {
  const lives = Math.max(0, e.lives - 1);
  return {
    ...e,
    lives,
    eliminated: lives <= 0,
    // stripped of killer status when out
    isKiller: lives <= 0 ? false : e.isKiller,
  };
}

export function finalizeKillerTurn(state: GameState): ApplyDartResult {
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  if (next.status !== "playing" && next.status !== "match_won") {
    return { state: next, events };
  }

  const player = currentPlayer(next);
  const ps = currentPlayerState(next);
  const me = extra(ps);

  if (next.currentTurnDarts.length > 0) {
    const turn = {
      playerId: player.id,
      darts: [...next.currentTurnDarts],
      startScore: me.lives,
      endScore: me.lives,
      bust: false,
      checkout: false,
      timestamp: Date.now(),
    };
    next.turns.push(turn);
    next.currentTurnDarts = [];
    events.push({ type: "turn_end", payload: turn, timestamp: Date.now() });
  } else {
    next.currentTurnDarts = [];
  }

  if (next.status === "match_won") {
    return { state: next, events };
  }

  // Advance to next alive player
  next.currentPlayerIndex = nextAliveIndex(next, next.currentPlayerIndex);
  return { state: next, events };
}

/** Validate setup before createGame */
export function validateKillerNumbers(
  players: { id: string; name: string }[],
  playerNumbers: Record<string, number>
): string | null {
  if (players.length < 2) return "Killer needs at least 2 players";
  const used = new Set<number>();
  for (const p of players) {
    const n = playerNumbers[p.id];
    if (n == null || n < 1 || n > 20) return `${p.name} needs a number from 1–20`;
    if (used.has(n)) return `Number ${n} is already taken`;
    used.add(n);
  }
  return null;
}
