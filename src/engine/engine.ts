/**
 * Game engine orchestrator – pure functions, no React.
 * Modes are pluggable; UI and camera both call applyDart / endTurn / undo.
 */

import { createId } from "./dart";
import { getCheckoutSuggestion } from "./checkout";
import type {
  ApplyDartResult,
  CheckoutSuggestion,
  DartThrow,
  GameModeId,
  GameState,
  MatchFormat,
  ModeConfig,
  PlayerRef,
  TeamRef,
} from "./types";
import { cloneState, type GameModeHandler } from "./modes/base";
import { x01Handler, finalizeX01Turn } from "./modes/x01";
import { cricketHandler, finalizeCricketTurn } from "./modes/cricket";
import { shanghaiHandler, finalizeShanghaiTurn } from "./modes/shanghai";
import { countUpHandler, finalizeCountUpTurn } from "./modes/countup";
import { aroundTheClockHandler, finalizeAroundTurn } from "./modes/around-the-clock";
import { bermudaHandler, finalizeBermudaTurn } from "./modes/bermuda";
import { randomCheckoutHandler, finalizeRandomCheckoutTurn } from "./modes/random-checkout";
import { killerHandler, finalizeKillerTurn } from "./modes/killer";
import {
  advanceThrower,
  buildThrowOrder,
  modeSupportsTeams,
  nextLegStartingIndex,
  soloTeamsFromPlayers,
} from "./teams";

const HANDLERS: Record<GameModeId, GameModeHandler> = {
  x01: x01Handler,
  cricket: cricketHandler,
  shanghai: shanghaiHandler,
  countup: countUpHandler,
  around_the_clock: aroundTheClockHandler,
  bermuda: bermudaHandler,
  random_checkout: randomCheckoutHandler,
  killer: killerHandler,
};

const FINALIZERS: Record<GameModeId, (s: GameState) => ApplyDartResult> = {
  x01: finalizeX01Turn,
  cricket: finalizeCricketTurn,
  shanghai: finalizeShanghaiTurn,
  countup: finalizeCountUpTurn,
  around_the_clock: finalizeAroundTurn,
  bermuda: finalizeBermudaTurn,
  random_checkout: finalizeRandomCheckoutTurn,
  killer: finalizeKillerTurn,
};

export function getHandler(mode: GameModeId): GameModeHandler {
  const h = HANDLERS[mode];
  if (!h) throw new Error(`Unknown mode: ${mode}`);
  return h;
}

export function listModes(): Array<{ id: GameModeId; name: string; description: string }> {
  return (Object.keys(HANDLERS) as GameModeId[]).map((id) => ({
    id,
    name: HANDLERS[id].displayName,
    description: HANDLERS[id].description,
  }));
}

export interface CreateGameOptions {
  modeConfig: ModeConfig;
  players: PlayerRef[];
  matchFormat?: MatchFormat;
  roomId?: string;
  /** Who throws first (index into players) */
  startingPlayerIndex?: number;
  /**
   * Teams for doubles / pairs. Omit for free-for-all (each player alone).
   * Doubles: 2 teams of 2. Not used for killer / random checkout.
   */
  teams?: TeamRef[];
}

export function createGame(opts: CreateGameOptions): GameState {
  if (opts.players.length < 1 || opts.players.length > 8) {
    throw new Error("Players must be between 1 and 8");
  }

  const mode = opts.modeConfig.mode;
  let teams: TeamRef[];
  if (opts.teams?.length && modeSupportsTeams(mode)) {
    teams = opts.teams;
    // validate membership
    const ids = new Set(opts.players.map((p) => p.id));
    for (const t of teams) {
      if (t.playerIds.length < 1 || t.playerIds.length > 2) {
        throw new Error("Each team must have 1 or 2 players (singles / doubles)");
      }
      for (const pid of t.playerIds) {
        if (!ids.has(pid)) throw new Error(`Unknown player on team ${t.name}`);
      }
    }
  } else {
    teams = soloTeamsFromPlayers(opts.players);
  }

  const throwOrder = buildThrowOrder(opts.players, teams);
  const startIdx =
    opts.startingPlayerIndex != null && throwOrder.includes(opts.startingPlayerIndex)
      ? opts.startingPlayerIndex
      : throwOrder[0] ?? 0;

  const base: GameState = {
    id: createId("match"),
    status: "setup",
    mode,
    modeConfig: opts.modeConfig,
    matchFormat: opts.matchFormat ?? { legsToWin: 1, setsToWin: 1 },
    players: opts.players,
    playerStates: [],
    teams,
    throwOrder,
    currentPlayerIndex: startIdx,
    currentTurnDarts: [],
    turns: [],
    legNumber: 1,
    setNumber: 1,
    roundIndex: 0,
    winnerId: null,
    legWinnerId: null,
    winnerTeamId: null,
    legWinnerTeamId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    roomId: opts.roomId,
    pausedAt: null,
    turnBaseline: null,
  };

  const handler = getHandler(base.mode);
  const state = handler.initLeg(base);
  // Attach teamId on player states after init
  for (const ps of state.playerStates) {
    const team = teams.find((t) => t.playerIds.includes(ps.playerId));
    if (team) ps.teamId = team.id;
  }
  state.teams = teams;
  state.throwOrder = throwOrder;
  state.currentPlayerIndex = startIdx;
  state.status = "playing";
  state.turnBaseline = structuredClone(state.playerStates);
  state.updatedAt = Date.now();
  return state;
}

function captureBaseline(state: GameState): GameState {
  const next = cloneState(state);
  next.turnBaseline = structuredClone(next.playerStates);
  return next;
}

/** Apply a dart without auto-ending the turn (for turn rebuilds). */
export function applyDartRaw(state: GameState, dart: DartThrow): ApplyDartResult {
  if (state.status !== "playing" && state.status !== "leg_won" && state.status !== "match_won") {
    // allow playing primarily
  }
  if (state.status !== "playing") {
    return { state, events: [], callout: "Game not active" };
  }
  if (state.currentTurnDarts.length >= 3) {
    return { state, events: [], callout: "Turn full" };
  }
  const handler = getHandler(state.mode);
  const result = handler.applyDart(state, dart);
  result.state.updatedAt = Date.now();
  return result;
}

/** Apply a dart; auto-finalize turn when mode says so */
export function applyDart(state: GameState, dart: DartThrow): ApplyDartResult {
  if (state.status !== "playing") {
    return { state, events: [], callout: "Game not active" };
  }
  if (state.currentTurnDarts.length >= 3) {
    return { state, events: [], callout: "Turn full – end turn" };
  }

  // Snapshot player state at the first dart of a visit
  let working = state;
  if (working.currentTurnDarts.length === 0) {
    working = captureBaseline(working);
  }

  const handler = getHandler(working.mode);
  let result = handler.applyDart(working, dart);
  result.state.updatedAt = Date.now();

  // Auto end turn when appropriate (and not already leg/match over)
  if (
    result.state.status === "playing" &&
    handler.shouldEndTurn(result.state)
  ) {
    const fin = FINALIZERS[result.state.mode](result.state);
    // New visit baseline for next thrower
    fin.state.turnBaseline = structuredClone(fin.state.playerStates);
    result = {
      state: fin.state,
      events: [...result.events, ...fin.events],
      callout: fin.callout ?? result.callout,
    };
  }

  result.state.updatedAt = Date.now();
  return result;
}

/**
 * Autodarts-style correction: replace the entire current visit with a new dart list
 * by replaying from turnBaseline (undoes side effects of bad detections).
 */
export function correctCurrentTurn(
  state: GameState,
  darts: DartThrow[],
  opts?: { autoEnd?: boolean }
): ApplyDartResult {
  // Corrections are for the live visit (or reopened leg)
  if (state.status !== "playing" && state.status !== "leg_won" && state.status !== "match_won") {
    return { state, events: [], callout: "Cannot correct now" };
  }

  const baseline = state.turnBaseline ?? state.playerStates;
  let next = cloneState(state);
  next.status = "playing";
  next.legWinnerId = null;
  next.winnerId = null;
  next.playerStates = structuredClone(baseline);
  next.currentTurnDarts = [];
  next.updatedAt = Date.now();

  const events: ApplyDartResult["events"] = [
    { type: "undo", payload: { correct: true }, timestamp: Date.now() },
  ];
  let callout = "CORRECTED";
  const limited = darts.slice(0, 3);

  for (let i = 0; i < limited.length; i++) {
    const isLast = i === limited.length - 1;
    if (opts?.autoEnd !== false && isLast && limited.length === 3) {
      const r = applyDart(next, limited[i]);
      next = r.state;
      events.push(...r.events);
      callout = r.callout ?? callout;
    } else {
      const r = applyDartRaw(next, limited[i]);
      next = r.state;
      events.push(...r.events);
      callout = r.callout ?? callout;
      // If raw apply already won match mid-list, stop
      if (next.status !== "playing") break;
    }
  }

  next.updatedAt = Date.now();
  return { state: next, events, callout };
}

/** Replace a single dart in the current visit (index 0–2). */
export function correctTurnDartAt(
  state: GameState,
  index: number,
  dart: DartThrow | null
): ApplyDartResult {
  if (index < 0 || index > 2) {
    return { state, events: [], callout: "Invalid dart slot" };
  }
  const list = [...state.currentTurnDarts];
  if (dart === null) {
    if (index >= list.length) {
      return { state, events: [], callout: "Nothing to clear" };
    }
    list.splice(index, 1);
  } else if (index < list.length) {
    list[index] = dart;
  } else if (index === list.length) {
    list.push(dart);
  } else {
    return { state, events: [], callout: "Fill earlier darts first" };
  }
  return correctCurrentTurn(state, list, { autoEnd: false });
}

/**
 * Re-open the last completed visit for editing (all darts restored).
 * Like Autodarts undo-to-edit rather than undo-one-dart.
 */
export function editLastTurn(state: GameState): ApplyDartResult {
  if (state.currentTurnDarts.length > 0) {
    return { state, events: [], callout: "Finish or clear current darts first" };
  }
  if (state.turns.length === 0) {
    return { state, events: [], callout: "Nothing to edit" };
  }

  const next = cloneState(state);
  const last = next.turns.pop()!;
  const pIdx = next.players.findIndex((p) => p.id === last.playerId);
  if (pIdx < 0) return { state, events: [], callout: "Player missing" };

  next.currentPlayerIndex = pIdx;
  const ps = next.playerStates[pIdx];

  if (last.checkout) {
    next.status = "playing";
    next.legWinnerId = null;
    next.winnerId = null;
    ps.legsWon = Math.max(0, ps.legsWon - (last.checkout ? 1 : 0));
    ps.checkoutsHit = Math.max(0, ps.checkoutsHit - 1);
  }
  if (next.status === "match_won" || next.status === "leg_won") {
    next.status = "playing";
    next.winnerId = null;
    next.legWinnerId = null;
  }

  // Restore score/state to start of that visit
  ps.score = last.startScore;
  // Build baseline = current states with this player's score reset (approx)
  // Prefer: reverse endScore → startScore for thrower only already done
  next.turnBaseline = structuredClone(next.playerStates);
  // Replay last.darts via correction so mode side-effects re-apply cleanly
  // First set player states: for X01 startScore is enough; for killer/cricket
  // we need baseline from before the turn. Use startScore on thrower and
  // re-apply darts — imperfect for multi-player side effects in one dart.
  // For killer: undo lives by replaying from a reconstructed baseline is hard
  // without full history. We store baseline on each turn end going forward.

  next.currentTurnDarts = [];
  next.playerStates[pIdx].score = last.startScore;
  next.turnBaseline = structuredClone(next.playerStates);

  // Put darts back without auto-ending
  let working = next;
  for (const d of last.darts) {
    const r = applyDartRaw(working, d);
    working = r.state;
  }
  // Fix dartsThrown approximation
  working.updatedAt = Date.now();
  return {
    state: working,
    events: [{ type: "undo", payload: { editLast: true }, timestamp: Date.now() }],
    callout: "EDIT VISIT",
  };
}

/** Manually end turn early (e.g. player only threw 1–2 darts) */
export function endTurn(state: GameState): ApplyDartResult {
  if (state.status !== "playing") return { state, events: [] };
  if (state.currentTurnDarts.length === 0) {
    // Pass – advance player
    const next = cloneState(state);
    advanceThrower(next);
    next.turnBaseline = structuredClone(next.playerStates);
    next.updatedAt = Date.now();
    return { state: next, events: [{ type: "turn_end", timestamp: Date.now() }], callout: "PASS" };
  }
  const result = FINALIZERS[state.mode](state);
  result.state.turnBaseline = structuredClone(result.state.playerStates);
  result.state.updatedAt = Date.now();
  return result;
}

/** Undo last dart in current turn, or last completed turn if turn empty */
export function undo(state: GameState): ApplyDartResult {
  const next = cloneState(state);

  if (next.currentTurnDarts.length > 0) {
    next.currentTurnDarts.pop();
    // Approximate dartsThrown undo
    const ps = next.playerStates[next.currentPlayerIndex];
    if (ps.dartsThrown > 0) ps.dartsThrown -= 1;
    next.updatedAt = Date.now();
    return {
      state: next,
      events: [{ type: "undo", timestamp: Date.now() }],
      callout: "UNDO",
    };
  }

  // Restore previous turn – simplified: re-hydrate from turn log
  if (next.turns.length === 0) {
    return { state: next, events: [], callout: "Nothing to undo" };
  }

  // Full turn undo is complex across modes; store snapshot stack preferred.
  // Here we pop last turn and reverse score delta for X01-like modes.
  const last = next.turns.pop()!;
  const pIdx = next.players.findIndex((p) => p.id === last.playerId);
  if (pIdx >= 0) {
    next.currentPlayerIndex = pIdx;
    const ps = next.playerStates[pIdx];
    if (last.checkout && next.status === "leg_won") {
      next.status = "playing";
      next.legWinnerId = null;
      ps.legsWon = Math.max(0, ps.legsWon - 1);
    }
    if (next.winnerId) {
      next.winnerId = null;
      next.status = "playing";
      ps.setsWon = Math.max(0, ps.setsWon - (last.checkout ? 0 : 0));
    }
    // Restore score to start of that turn
    ps.score = last.startScore;
    ps.dartsThrown = Math.max(0, ps.dartsThrown - last.darts.length);
    if (last.checkout) {
      ps.checkoutsHit = Math.max(0, ps.checkoutsHit - 1);
    }
    // Put darts back so user can undo dart-by-dart
    next.currentTurnDarts = [...last.darts];
    // Pop one dart so undo feels like undoing the last action
    if (next.currentTurnDarts.length > 0) {
      next.currentTurnDarts.pop();
      if (ps.dartsThrown > 0) ps.dartsThrown -= 1;
    }
  }

  next.updatedAt = Date.now();
  return {
    state: next,
    events: [{ type: "undo", timestamp: Date.now() }],
    callout: "UNDO",
  };
}

export function pauseGame(state: GameState): GameState {
  if (state.status !== "playing") return state;
  const next = cloneState(state);
  next.status = "paused";
  next.pausedAt = Date.now();
  next.updatedAt = Date.now();
  return next;
}

export function resumeGame(state: GameState): GameState {
  if (state.status !== "paused") return state;
  const next = cloneState(state);
  next.status = "playing";
  next.pausedAt = null;
  next.updatedAt = Date.now();
  return next;
}

/** Start next leg after leg_won */
export function startNextLeg(state: GameState): GameState {
  if (state.status !== "leg_won" && state.status !== "playing") {
    // allow from leg_won primarily
  }
  if (state.status === "match_won" || state.status === "finished") return state;

  const next = cloneState(state);
  next.legNumber += 1;
  // Loser team starts next leg (first thrower of non-winning team in order)
  next.currentPlayerIndex = nextLegStartingIndex(next, next.legWinnerId);
  const handler = getHandler(next.mode);
  const reset = handler.initLeg(next);
  reset.teams = next.teams;
  reset.throwOrder = next.throwOrder;
  reset.legNumber = next.legNumber;
  reset.setNumber = next.setNumber;
  reset.turns = next.turns;
  reset.currentPlayerIndex = next.currentPlayerIndex;
  reset.status = "playing";
  reset.legWinnerId = null;
  reset.legWinnerTeamId = null;
  reset.updatedAt = Date.now();
  // re-attach team ids
  for (const ps of reset.playerStates) {
    const team = reset.teams?.find((t) => t.playerIds.includes(ps.playerId));
    if (team) ps.teamId = team.id;
  }
  return reset;
}

export function getRemaining(state: GameState, playerId: string): number {
  const handler = getHandler(state.mode);
  if (handler.getRemaining) return handler.getRemaining(state, playerId);
  return state.playerStates.find((p) => p.playerId === playerId)?.score ?? 0;
}

export function suggestCheckout(state: GameState): CheckoutSuggestion | null {
  if (state.mode !== "x01" && state.mode !== "random_checkout") return null;
  const doubleOut =
    state.mode === "x01"
      ? state.modeConfig.mode === "x01" && state.modeConfig.config.doubleOut
      : true;
  const pid = state.players[state.currentPlayerIndex]?.id;
  if (!pid) return null;
  const remaining = getRemaining(state, pid);
  const dartsLeft = 3 - state.currentTurnDarts.length;
  return getCheckoutSuggestion(remaining, dartsLeft, doubleOut);
}

export function threeDartAverage(ps: { totalScore: number; dartsThrown: number }): number {
  if (ps.dartsThrown < 3) return 0;
  return Math.round((ps.totalScore / ps.dartsThrown) * 3 * 10) / 10;
}

export function first9Average(ps: { first9Total: number; first9Darts: number }): number {
  if (ps.first9Darts < 3) return 0;
  return Math.round((ps.first9Total / ps.first9Darts) * 3 * 10) / 10;
}

/** Register a custom mode at runtime (future extensions) */
export function registerMode(id: string, handler: GameModeHandler, finalizer: (s: GameState) => ApplyDartResult) {
  (HANDLERS as Record<string, GameModeHandler>)[id] = handler;
  (FINALIZERS as Record<string, (s: GameState) => ApplyDartResult>)[id] = finalizer;
}
