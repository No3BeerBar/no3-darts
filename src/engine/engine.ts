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
  PlayerGameState,
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
import { baseballHandler, finalizeBaseballTurn } from "./modes/baseball";
import { fortyOneHandler, finalizeFortyOneTurn } from "./modes/forty-one";
import {
  advanceThrower,
  buildThrowOrder,
  modeSupportsTeams,
  nextLegStartingIndex,
  soloTeamsFromPlayers,
} from "./teams";
import { tagNewTurnsWithLeg } from "./player-stats";
import { resolveModeConfig } from "./mode-defaults";

const HANDLERS: Record<GameModeId, GameModeHandler> = {
  x01: x01Handler,
  cricket: cricketHandler,
  shanghai: shanghaiHandler,
  countup: countUpHandler,
  around_the_clock: aroundTheClockHandler,
  bermuda: bermudaHandler,
  random_checkout: randomCheckoutHandler,
  killer: killerHandler,
  baseball: baseballHandler,
  forty_one: fortyOneHandler,
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
  baseball: finalizeBaseballTurn,
  forty_one: finalizeFortyOneTurn,
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
  /** Optional tournament bracket linkage (additive — casual play omits). */
  tournamentMeta?: GameState["tournamentMeta"];
}

export function createGame(opts: CreateGameOptions): GameState {
  if (opts.players.length < 1 || opts.players.length > 8) {
    throw new Error("Players must be between 1 and 8");
  }

  const modeConfig = resolveModeConfig(opts.modeConfig);
  const mode = modeConfig.mode;
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
    modeConfig,
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
    tournamentMeta: opts.tournamentMeta,
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
  const prevTurns = state.turns.length;
  const handler = getHandler(state.mode);
  const result = handler.applyDart(state, dart);
  tagNewTurnsWithLeg(result.state, prevTurns);
  result.state.updatedAt = Date.now();
  return result;
}

/** Mark darts as edited (challenge integrity — uncorrected-only scoring). */
function markDartsEdited(darts: DartThrow[]): DartThrow[] {
  return darts.map((d) => (d.edited ? d : { ...d, edited: true }));
}

/**
 * Stash start-of-visit baseline onto turns that were just finalized,
 * and stamp `edited` when the open visit was rewritten.
 */
function attachBaselineToNewTurns(
  state: GameState,
  prevTurnCount: number,
  baseline: PlayerGameState[] | null | undefined
): void {
  const visitEdited = Boolean(state.currentVisitEdited);
  for (let i = prevTurnCount; i < state.turns.length; i++) {
    const turn = state.turns[i];
    const edited =
      visitEdited || Boolean(turn.edited) || turn.darts.some((d) => d.edited);
    const nextTurn: typeof turn = {
      ...turn,
      ...(baseline?.length && !turn.baselineStates
        ? { baselineStates: structuredClone(baseline) }
        : {}),
    };
    if (edited) {
      nextTurn.edited = true;
      nextTurn.darts = markDartsEdited(turn.darts);
    }
    state.turns[i] = nextTurn;
  }
  if (state.turns.length > prevTurnCount) {
    state.currentVisitEdited = false;
  }
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

  const visitBaseline = working.turnBaseline;
  const prevTurns = working.turns.length;
  const handler = getHandler(working.mode);
  let result = handler.applyDart(working, dart);
  tagNewTurnsWithLeg(result.state, prevTurns);
  // Turns pushed mid-apply (e.g. cricket checkout) need the start baseline
  attachBaselineToNewTurns(result.state, prevTurns, visitBaseline);

  // Auto end turn when appropriate (and not already leg/match over)
  if (
    result.state.status === "playing" &&
    handler.shouldEndTurn(result.state)
  ) {
    const beforeFin = result.state.turns.length;
    const baselineForFin = result.state.turnBaseline ?? visitBaseline;
    const fin = FINALIZERS[result.state.mode](result.state);
    tagNewTurnsWithLeg(fin.state, beforeFin);
    attachBaselineToNewTurns(fin.state, beforeFin, baselineForFin);
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
  // Any correct/undo rewrite voids challenge credit for this visit.
  next.currentVisitEdited = true;
  next.updatedAt = Date.now();

  const events: ApplyDartResult["events"] = [
    { type: "undo", payload: { correct: true }, timestamp: Date.now() },
  ];
  let callout = "CORRECTED";
  const limited = markDartsEdited(darts.slice(0, 3));

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
      // Exact-41 / X01-style bust: finalize even on a 1-2 dart rewrite.
      // Leaving T19 (57) open on 41 was letting darts 2 and 3 still throw.
      const handler = getHandler(next.mode);
      if (handler.shouldEndTurn(next)) {
        const beforeFin = next.turns.length;
        const baselineForFin = next.turnBaseline ?? baseline;
        const fin = FINALIZERS[next.mode](next);
        tagNewTurnsWithLeg(fin.state, beforeFin);
        attachBaselineToNewTurns(fin.state, beforeFin, baselineForFin);
        fin.state.turnBaseline = structuredClone(fin.state.playerStates);
        next = fin.state;
        events.push(...fin.events);
        callout = fin.callout ?? callout;
        break;
      }
    }
  }

  // Preserve edited flags on the open visit. If auto-end finalized the turn,
  // attachBaselineToNewTurns already stamped Turn.edited and cleared the flag —
  // do not leak currentVisitEdited onto the next thrower's visit.
  if (next.currentTurnDarts.length > 0) {
    next.currentTurnDarts = markDartsEdited(next.currentTurnDarts);
    next.currentVisitEdited = true;
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
  // 3-dart rewrite must finalize (same as camera /correct). Leaving a full
  // visit open after Fix dart is the iPad deadlock: board taps no-op, End
  // turn is staff-only, only End game remains.
  return correctCurrentTurn(state, list, { autoEnd: list.length >= 3 });
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

  // Restore full start-of-visit playerStates when we stored them (Cricket/Killer).
  // Legacy turns without baselineStates fall back to score-only restore.
  next.currentTurnDarts = [];
  // Reopening a visit always voids challenge credit for the re-finalized turn.
  next.currentVisitEdited = true;
  if (last.baselineStates?.length) {
    next.playerStates = structuredClone(last.baselineStates);
    next.turnBaseline = structuredClone(last.baselineStates);
  } else {
    ps.score = last.startScore;
    next.playerStates[pIdx].score = last.startScore;
    next.turnBaseline = structuredClone(next.playerStates);
  }

  // Put darts back without auto-ending (mark edited so credit stays void).
  // applyDartRaw still runs mode applyDart, which finalizes X01 / random-checkout
  // busts (and checkouts) in-handler. Accepting that re-closes the visit and
  // advances the thrower — undo then sees an empty visit and returns the
  // re-busted state. Keep a re-finalizing dart on the open visit instead.
  let working = next;
  for (const d of markDartsEdited(last.darts)) {
    const r = applyDartRaw(working, d);
    if (r.state.turns.length > working.turns.length) {
      const open = cloneState(working);
      open.currentTurnDarts = [...open.currentTurnDarts, d];
      const psOpen = open.playerStates[open.currentPlayerIndex];
      if (psOpen) psOpen.dartsThrown += 1;
      working = open;
      break;
    }
    working = r.state;
  }
  working.currentTurnDarts = markDartsEdited(working.currentTurnDarts);
  working.currentVisitEdited = true;
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
  const baseline = state.turnBaseline;
  const prevTurns = state.turns.length;
  const result = FINALIZERS[state.mode](state);
  tagNewTurnsWithLeg(result.state, prevTurns);
  attachBaselineToNewTurns(result.state, prevTurns, baseline);
  result.state.turnBaseline = structuredClone(result.state.playerStates);
  result.state.updatedAt = Date.now();
  return result;
}

/** True when Undo can step backward at least one dart / visit. */
export function canUndo(state: GameState): boolean {
  if (
    state.status !== "playing" &&
    state.status !== "leg_won" &&
    state.status !== "match_won"
  ) {
    return false;
  }
  if (state.currentTurnDarts.length > 0) return true;
  return state.turns.length > 0;
}

/**
 * Undo last applied dart (camera or manual), one step per call.
 *
 * - Mid-visit: rebuild from turnBaseline without the last dart (mode-safe).
 * - Empty visit: reopen the previous completed visit, then drop its last dart
 *   so repeated Undo walks backward dart-by-dart through recent throws.
 */
export function undo(state: GameState): ApplyDartResult {
  if (!canUndo(state)) {
    return { state, events: [], callout: "Nothing to undo" };
  }

  // Mid-visit: correctCurrentTurn replays from baseline (scores / marks / lives)
  if (state.currentTurnDarts.length > 0) {
    const remaining = state.currentTurnDarts.slice(0, -1);
    const result = correctCurrentTurn(state, remaining, { autoEnd: false });
    return {
      state: result.state,
      events: [
        { type: "undo", timestamp: Date.now() },
        ...result.events.filter((e) => e.type !== "undo"),
      ],
      callout: "UNDO",
    };
  }

  // Visit already closed (3rd dart / end-turn / bust) — reopen then drop last dart
  const reopened = editLastTurn(state);
  if (reopened.state.currentTurnDarts.length === 0) {
    return {
      state: reopened.state,
      events: reopened.events,
      callout: reopened.callout === "Nothing to edit" ? "Nothing to undo" : "UNDO",
    };
  }
  const remaining = reopened.state.currentTurnDarts.slice(0, -1);
  const result = correctCurrentTurn(reopened.state, remaining, { autoEnd: false });
  return {
    state: result.state,
    events: [
      { type: "undo", timestamp: Date.now() },
      ...reopened.events,
      ...result.events.filter((e) => e.type !== "undo"),
    ],
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
export function startNextLeg(
  state: GameState,
  opts?: { modeConfig?: ModeConfig }
): GameState {
  if (state.status !== "leg_won" && state.status !== "playing") {
    // allow from leg_won primarily
  }
  if (state.status === "match_won" || state.status === "finished") return state;

  const next = cloneState(state);
  next.legNumber += 1;
  // Tournament choose_each_leg / preset_sequence may change mode between legs
  if (opts?.modeConfig) {
    next.modeConfig = opts.modeConfig;
    next.mode = opts.modeConfig.mode;
  }
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
