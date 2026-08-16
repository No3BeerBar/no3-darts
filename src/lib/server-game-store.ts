/**
 * In-memory server-side match registry for camera / REST integration.
 * Clients can push active match state here; camera posts darts against matchId.
 * For multi-instance Railway, swap for Redis later.
 */

import type { DartDetectedEvent, GameState, SegmentKind } from "@/engine/types";
import {
  applyDart,
  canUndo,
  correctCurrentTurn,
  createDart,
  endTurn,
  undo,
} from "@/engine";
import {
  healthIndicatesTakeout,
  isCameraBridgeOffline,
  isLiveTakeoutSignal,
  isStaleCameraHealth,
  type CameraHealth,
} from "@/lib/camera-health";
import { isLiveMatchStatus, isScoringLiveStatus } from "@/lib/live-match";

export type { CameraHealth } from "@/lib/camera-health";
export {
  isCameraBridgeOffline,
  isLiveTakeoutSignal,
  isStaleCameraHealth,
  shouldShowTakeoutUi,
  statusLooksLikeTakeout,
  CAMERA_HEALTH_FRESH_MS,
} from "@/lib/camera-health";

type Listener = (event: { type: string; data: unknown }) => void;

const matches = new Map<string, GameState>();
const byRoom = new Map<string, string>(); // roomId -> matchId
const listeners = new Set<Listener>();
/** Match ids dropped by End game / finish — ignore late tablet heartbeats. */
const removedMatchIds = new Map<string, number>();
/** First time we saw `match_won` for an id — linger clock must not reset on heartbeats. */
const matchWonAt = new Map<string, number>();

/** Ignore resurrecting a cleared match for this long (in-flight POST). */
export const CLEARED_MATCH_TOMBSTONE_MS = 45_000;
/** Winner stays on GET /active for the HDMI result hold, then attract. */
export const MATCH_WON_ACTIVE_MS = 30_000;

type RoomTombstone = { matchId: string; updatedAt: number; removedAt: number };
const removedRooms = new Map<string, RoomTombstone>();

function normalizeRoomId(roomId: string): string {
  let s = (roomId || "").trim().replace(/\s+/g, " ");
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s).trim().replace(/\s+/g, " ");
    } catch {
      /* keep raw */
    }
  }
  return s;
}

function isTombstoned(id: string, now = Date.now()): boolean {
  const t = removedMatchIds.get(id);
  if (t == null) return false;
  if (now - t > CLEARED_MATCH_TOMBSTONE_MS) {
    removedMatchIds.delete(id);
    return false;
  }
  return true;
}

function roomTombstoneKey(roomId: string): string {
  return normalizeRoomId(roomId).toLowerCase();
}

/** Same id, or same room with an older/equal snapshot than the match we just ended. */
function shouldRefuseRevive(state: GameState, now = Date.now()): boolean {
  if (isTombstoned(state.id, now)) return true;
  const room = state.roomId;
  if (!room) return false;
  const key = roomTombstoneKey(room);
  const t = removedRooms.get(key);
  if (!t) return false;
  if (now - t.removedAt > CLEARED_MATCH_TOMBSTONE_MS) {
    removedRooms.delete(key);
    return false;
  }
  if (state.id === t.matchId) return true;
  // Older snapshot for this room (in-flight heartbeat). Equal/newer + new id = next game.
  return (state.updatedAt ?? 0) < t.updatedAt;
}

function pruneInactiveMatches(now = Date.now()): void {
  for (const m of [...matches.values()]) {
    if (!isLiveMatchStatus(m.status)) {
      removeServerMatch(m.id);
      continue;
    }
    if (m.status === "match_won") {
      const wonAt = matchWonAt.get(m.id) ?? m.updatedAt ?? 0;
      if (now - wonAt >= MATCH_WON_ACTIVE_MS) {
        removeServerMatch(m.id);
      }
    }
  }
}

function indexRoom(roomId: string, matchId: string): void {
  const raw = roomId;
  const norm = normalizeRoomId(roomId);
  byRoom.set(raw, matchId);
  byRoom.set(norm, matchId);
  byRoom.set(norm.toLowerCase(), matchId);
}

function unindexRoom(roomId: string | undefined, matchId: string): void {
  if (roomId) {
    byRoom.delete(roomId);
    const norm = normalizeRoomId(roomId);
    byRoom.delete(norm);
    byRoom.delete(norm.toLowerCase());
  }
  for (const [k, v] of [...byRoom.entries()]) {
    if (v === matchId) byRoom.delete(k);
  }
}

/** Latest camera / Board Manager health per room (from companion bridge). */
const cameraHealthByRoom = new Map<string, CameraHealth>();

export function upsertServerMatch(state: GameState): void {
  // Finished / setup leave the live registry so TV returns to attract.
  if (state.status === "finished" || state.status === "setup") {
    removeServerMatch(state.id);
    return;
  }
  // End game already cleared this id/room — do not let a late heartbeat resurrect it.
  if (shouldRefuseRevive(state)) {
    return;
  }

  const existing = matches.get(state.id);
  // Never let a stale tablet heartbeat wipe newer camera darts.
  // Heartbeats re-push local state every ~2.5s; if the camera scored first,
  // existing.updatedAt is ahead and we must keep the server copy.
  if (existing && (existing.updatedAt ?? 0) > (state.updatedAt ?? 0)) {
    return;
  }
  // Same timestamp: prefer the state with more progress (more darts / later turn)
  if (existing && (existing.updatedAt ?? 0) === (state.updatedAt ?? 0)) {
    const existN = countProgress(existing);
    const nextN = countProgress(state);
    if (existN > nextN) return;
  }
  const prev = existing;
  matches.set(state.id, state);
  if (state.status === "match_won") {
    // First won sighting only — later heartbeats must not extend the linger.
    if (!matchWonAt.has(state.id)) {
      matchWonAt.set(state.id, state.updatedAt ?? Date.now());
    }
  } else {
    matchWonAt.delete(state.id);
  }
  if (state.roomId) {
    const priorReady = readTakeoutReady(state.roomId);
    if (priorReady && priorReady.matchId !== state.id) {
      clearTakeoutReady(state.roomId);
    }
    indexRoom(state.roomId, state.id);
    removedRooms.delete(roomTombstoneKey(state.roomId));
  }
  realignCameraGateFromMatch(prev, state);
  emit({ type: "match_update", data: state });
}

/** Rough progress score so we don't clobber camera-applied turns. */
function countProgress(s: GameState): number {
  const turn = s.currentTurnDarts?.length ?? 0;
  const thrown = (s.playerStates ?? []).reduce((a, p) => a + (p.dartsThrown ?? 0), 0);
  return thrown * 10 + turn + (s.legNumber ?? 0) * 100;
}

export function getServerMatch(id: string): GameState | undefined {
  return matches.get(id);
}

export function getActiveByRoom(
  roomId: string,
  now = Date.now()
): GameState | undefined {
  pruneInactiveMatches(now);

  const pickLive = (m: GameState | undefined): GameState | undefined => {
    if (!m || !isLiveMatchStatus(m.status)) return undefined;
    if (m.status === "match_won") {
      const wonAt = matchWonAt.get(m.id) ?? m.updatedAt ?? 0;
      if (now - wonAt >= MATCH_WON_ACTIVE_MS) return undefined;
    }
    return m;
  };

  const exactId =
    byRoom.get(roomId) ??
    byRoom.get(normalizeRoomId(roomId)) ??
    byRoom.get(normalizeRoomId(roomId).toLowerCase());
  if (exactId) {
    const hit = pickLive(matches.get(exactId));
    if (hit) return hit;
  }
  // Case-insensitive / trimmed / decoded fallback (Board 1 vs Board%201)
  const want = normalizeRoomId(roomId).toLowerCase();
  for (const m of matches.values()) {
    if (normalizeRoomId(m.roomId || "").toLowerCase() === want) {
      const hit = pickLive(m);
      if (hit) return hit;
    }
  }
  // Sole in-progress match (not match_won) — helps after room rename, without
  // pinning an orphaned winner screen onto the wrong TV.
  const live = listServerMatches(now).filter((m) => isScoringLiveStatus(m.status));
  if (live.length === 1) return live[0];
  return undefined;
}

export function listServerMatches(now = Date.now()): GameState[] {
  pruneInactiveMatches(now);
  return Array.from(matches.values()).filter((m) => isLiveMatchStatus(m.status));
}

export function removeServerMatch(id: string): void {
  const m = matches.get(id);
  const existed = matches.has(id);
  matches.delete(id);
  matchWonAt.delete(id);
  unindexRoom(m?.roomId, id);
  if (m?.roomId) {
    clearTakeoutHold(m.roomId);
    // Leftover Ready must not authorize end-turn on the next game.
    clearTakeoutReady(m.roomId);
  }
  removedMatchIds.set(id, Date.now());
  if (m?.roomId) {
    removedRooms.set(roomTombstoneKey(m.roomId), {
      matchId: id,
      updatedAt: m.updatedAt ?? 0,
      removedAt: Date.now(),
    });
  }
  if (existed) emit({ type: "match_removed", data: { id } });
}

/** Test helper: drop in-memory matches + tombstones. */
export function resetServerGameStore(): void {
  matches.clear();
  byRoom.clear();
  removedMatchIds.clear();
  removedRooms.clear();
  matchWonAt.clear();
  takeoutReadyByRoom.clear();
}

function resolveMatch(opts: {
  matchId?: string;
  roomId?: string;
}): GameState | undefined {
  if (opts.matchId) {
    const m = matches.get(opts.matchId);
    if (m) return m;
  }
  if (opts.roomId) {
    const m = getActiveByRoom(opts.roomId);
    if (m) return m;
  }
  return listServerMatches().find((m) => m.status === "playing");
}

function currentThrowerIsBot(state: GameState): boolean {
  const p = state.players[state.currentPlayerIndex];
  return Boolean(p?.isBot || p?.botDifficulty != null);
}

function normRoom(roomId: string): string {
  return (roomId || "Board 1").trim() || "Board 1";
}

/**
 * Per-room camera visit gate.
 *
 * Hard invariant: while a visit is open for seat N, dart/correct/end-turn must
 * carry expectedPlayerIndex=N. After the visit closes, hold the *next* seat
 * until takeout is cleared / board empty (or patron Ready) so a late dart 3
 * cannot open the next thrower's visit.
 */
type RoomCameraGate = {
  /** Seat locked for the open Autodarts visit (null when no open visit). */
  openVisitSeat: number | null;
  /** After turn end - refuse next-seat scoring until takeout clear / Ready. */
  holdUntilTakeoutClear: boolean;
};

const cameraGateByRoom = new Map<string, RoomCameraGate>();

function getCameraGate(roomId: string): RoomCameraGate {
  const room = normRoom(roomId);
  let gate = cameraGateByRoom.get(room) ?? cameraGateByRoom.get(room.toLowerCase());
  if (!gate) {
    gate = { openVisitSeat: null, holdUntilTakeoutClear: false };
    cameraGateByRoom.set(room, gate);
    cameraGateByRoom.set(room.toLowerCase(), gate);
  }
  return gate;
}

export function clearTakeoutHold(roomId: string): void {
  const gate = getCameraGate(roomId);
  gate.holdUntilTakeoutClear = false;
  gate.openVisitSeat = null;
}

export function getCameraGateSnapshot(roomId: string): RoomCameraGate {
  const g = getCameraGate(roomId);
  return {
    openVisitSeat: g.openVisitSeat,
    holdUntilTakeoutClear: g.holdUntilTakeoutClear,
  };
}

/** Hard seat lock + takeout hold for camera dart/correct/end-turn. */
function seatLockRejected(
  state: GameState,
  expectedPlayerIndex: number | undefined,
  opts?: { allowEmptyVisit?: boolean; requireExpected?: boolean }
): string | null {
  const room = normRoom(state.roomId || "Board 1");
  const gate = getCameraGate(room);
  const visitOpen =
    state.currentTurnDarts.length > 0 || gate.openVisitSeat != null;
  // Fail closed for old companions: while any visit seat lock / takeout hold is
  // active, dart/correct/end-turn must carry expectedPlayerIndex.
  const seatLockActive =
    visitOpen || gate.holdUntilTakeoutClear || Boolean(opts?.requireExpected);

  if (
    seatLockActive &&
    (expectedPlayerIndex == null || !Number.isFinite(expectedPlayerIndex))
  ) {
    return "expectedPlayerIndex required while visit seat lock active";
  }

  // After premature/close: do not let late AD throws start the next seat's visit
  if (
    gate.holdUntilTakeoutClear &&
    state.currentTurnDarts.length === 0 &&
    !opts?.allowEmptyVisit
  ) {
    return "Takeout hold - pull darts before next visit scores";
  }

  // Empty end-turn READY ack during hold: field was required above; do not
  // seat-match against the *next* thrower (companion still sends prior seat).
  if (opts?.allowEmptyVisit && state.currentTurnDarts.length === 0) {
    return null;
  }

  if (visitOpen) {
    const want = Math.trunc(expectedPlayerIndex as number);
    const locked = gate.openVisitSeat ?? state.currentPlayerIndex;
    if (want !== state.currentPlayerIndex) {
      return `Seat mismatch - expected player ${want}, current is ${state.currentPlayerIndex}`;
    }
    if (gate.openVisitSeat != null && want !== locked) {
      return `Seat mismatch - expected player ${want}, current is ${state.currentPlayerIndex}`;
    }
    return null;
  }

  // New empty visit (no lock yet): optional expectedPlayerIndex, but if sent
  // it must match the current thrower.
  if (expectedPlayerIndex == null || !Number.isFinite(expectedPlayerIndex)) {
    return null;
  }
  const want = Math.trunc(expectedPlayerIndex);
  if (want !== state.currentPlayerIndex) {
    return `Seat mismatch - expected player ${want}, current is ${state.currentPlayerIndex}`;
  }
  return null;
}

function markVisitOpen(state: GameState): void {
  const room = normRoom(state.roomId || "Board 1");
  const gate = getCameraGate(room);
  gate.openVisitSeat = state.currentPlayerIndex;
  // Undo / correct reopened this visit. Clear hold only when Autodarts is
  // not still in takeout / yellow reset — otherwise keep the hold so
  // Reset takeout stays on /play instead of a silent no-score.
  const health = getCameraHealth(room);
  if (!isLiveTakeoutSignal(health)) {
    gate.holdUntilTakeoutClear = false;
  }
}

/**
 * Sandbox / dead bridge: never leave sticky takeout health or next-seat hold
 * when Autodarts is offline or the companion has gone silent.
 */
function reconcileStaleTakeout(roomId: string, now = Date.now()): void {
  const room = normRoom(roomId);
  const health = cameraHealthByRoom.get(room) ?? cameraHealthByRoom.get(room.toLowerCase());
  if (!health) return;
  const offline = isCameraBridgeOffline(health);
  const stale = isStaleCameraHealth(health, now);
  if (!offline && !stale) return;

  const hadTakeout = healthIndicatesTakeout(health);
  const gate = getCameraGate(room);
  if (!hadTakeout && !gate.holdUntilTakeoutClear) return;

  clearTakeoutHold(room);
  if (!hadTakeout) return;

  const cleared: CameraHealth = {
    ...health,
    takeout: false,
    level: health.level === "takeout" ? (offline ? "unhealthy" : "ok") : health.level,
    reason: offline ? "board_manager_offline" : "takeout_stale_cleared",
    message: offline
      ? health.message || "Board Manager offline"
      : "Takeout cleared (bridge silent)",
    connected: offline ? false : health.connected,
    ts: health.ts,
  };
  cameraHealthByRoom.set(room, cleared);
  cameraHealthByRoom.set(room.toLowerCase(), cleared);
}

function markVisitClosedForTakeout(state: GameState): void {
  const room = normRoom(state.roomId || "Board 1");
  const gate = getCameraGate(room);
  gate.openVisitSeat = null;
  gate.holdUntilTakeoutClear = true;
}

/**
 * Keep camera visit gate aligned after tablet Upsert / Undo.
 * Undo reopens a visit or walks progress backward - clear stuck takeout hold.
 */
function realignCameraGateFromMatch(
  prev: GameState | undefined,
  next: GameState
): void {
  if (!next.roomId) return;
  const gate = getCameraGate(next.roomId);
  if (next.currentTurnDarts.length > 0) {
    // Open visit (undo / mid-visit correct). Keep hold when AD is still
    // in takeout so Reset stays visible; mid-visit APPEND still scores.
    gate.openVisitSeat = next.currentPlayerIndex;
    if (!isLiveTakeoutSignal(getCameraHealth(next.roomId))) {
      gate.holdUntilTakeoutClear = false;
    }
    return;
  }
  if (prev && prev.currentTurnDarts.length > 0 && next.currentTurnDarts.length === 0) {
    if (countProgress(next) < countProgress(prev)) {
      // Undo walked back to an empty visit — allow rescoring
      gate.holdUntilTakeoutClear = false;
      gate.openVisitSeat = null;
      return;
    }
    if (next.status === "playing") {
      // Tablet Fix dart / End visit finalized the turn — arm hold so Reset
      // takeout is visible instead of a silent camera pause.
      markVisitClosedForTakeout(next);
    }
  }
}

/**
 * P0: while Autodarts takeout / remove-darts is active, the next seat must not
 * start a visit. Late dart 3 used to land here as "first dart" for the next
 * player after a premature end-turn. Incomplete visits (1-2 darts already on
 * the open turn) still accept APPEND so dart 3 can finish the same seat.
 *
 * Camera/bridge posts only — tablet manual taps and bot play use upsertMatch /
 * local applyDart and must never be gated by this hold.
 *
 * Also honors the server takeout hold latch (set on visit close) so a missing
 * health heartbeat cannot open the next seat — unless the bridge is offline or
 * the takeout health row is stale (sandbox / no Autodarts).
 */
function takeoutBlocksNewVisit(state: GameState, roomId?: string): string | null {
  if (state.currentTurnDarts.length > 0) return null;
  const room = normRoom(roomId || state.roomId || "Board 1");
  reconcileStaleTakeout(room);
  const gate = getCameraGate(room);
  if (gate.holdUntilTakeoutClear) {
    return "Takeout hold - pull darts before next visit scores";
  }
  const health = getCameraHealth(room);
  if (isLiveTakeoutSignal(health)) {
    return "Takeout active - scoring paused until reset";
  }
  return null;
}

export function applyCameraDart(
  event: DartDetectedEvent
): { ok: true; state: GameState; callout?: string; turnEnded: boolean } | { ok: false; error: string } {
  const state = resolveMatch({ matchId: event.matchId, roomId: event.roomId });

  if (!state) return { ok: false, error: "No active match found" };
  if (state.status !== "playing") return { ok: false, error: `Match status is ${state.status}` };
  // Bot seats generate their own darts on the tablet - ignore Autodarts/camera
  if (currentThrowerIsBot(state)) {
    return { ok: false, error: "Bot thrower - camera scoring paused" };
  }
  const seatErr = seatLockRejected(state, event.expectedPlayerIndex);
  if (seatErr) return { ok: false, error: seatErr };
  const takeoutErr = takeoutBlocksNewVisit(state, event.roomId);
  if (takeoutErr) return { ok: false, error: takeoutErr };

  const beforePlayer = state.currentPlayerIndex;
  const beforeTurnLen = state.currentTurnDarts.length;

  // Visit already complete but not finalized (3-dart correct with autoEnd
  // off, or a stuck "Turn full" visit). Finalize so the next seat can throw
  // instead of silently dropping every later dart.
  if (beforeTurnLen >= 3) {
    const fin = endTurn(state);
    matches.set(fin.state.id, fin.state);
    markVisitClosedForTakeout(fin.state);
    emit({
      type: "dart_detected",
      data: {
        state: fin.state,
        callout: fin.callout ?? "NEXT",
        turnEnded: true,
      },
    });
    return { ok: true, state: fin.state, callout: fin.callout, turnEnded: true };
  }

  const dart = createDart(event.kind, event.number, {
    angle: event.angle,
    radius: event.radius,
    source: "camera",
    timestamp: event.timestamp,
  });

  const result = applyDart(state, dart);
  matches.set(result.state.id, result.state);
  const turnEnded =
    result.state.currentTurnDarts.length === 0 ||
    result.state.currentPlayerIndex !== beforePlayer ||
    result.state.status !== "playing";

  if (turnEnded) {
    markVisitClosedForTakeout(result.state);
  } else {
    markVisitOpen(result.state);
  }

  emit({
    type: "dart_detected",
    data: {
      dart,
      state: result.state,
      callout: result.callout,
      confidence: event.confidence,
      turnEnded,
    },
  });

  return { ok: true, state: result.state, callout: result.callout, turnEnded };
}

/** Hands pulled darts / takeout - advance to next thrower if visit still open. */
export function applyCameraEndTurn(opts: {
  matchId?: string;
  roomId?: string;
  expectedPlayerIndex?: number;
}): { ok: true; state: GameState; callout?: string } | { ok: false; error: string } {
  const state = resolveMatch(opts);
  if (!state) return { ok: false, error: "No active match found" };
  if (state.status !== "playing") {
    return { ok: false, error: `Match status is ${state.status}` };
  }
  if (currentThrowerIsBot(state)) {
    return { ok: false, error: "Bot thrower - camera scoring paused" };
  }

  // Visit already empty (3rd dart auto-ended) - re-broadcast; keep takeout hold.
  // Fail closed: while hold/lock is active, old companions without
  // expectedPlayerIndex must not get a silent READY ack.
  if (state.currentTurnDarts.length === 0) {
    const seatErr = seatLockRejected(state, opts.expectedPlayerIndex, {
      allowEmptyVisit: true,
      requireExpected: true,
    });
    if (seatErr) return { ok: false, error: seatErr };
    markVisitClosedForTakeout(state);
    emit({ type: "match_update", data: state });
    return { ok: true, state, callout: "READY" };
  }

  const seatErr = seatLockRejected(state, opts.expectedPlayerIndex, {
    requireExpected: true,
  });
  if (seatErr) return { ok: false, error: seatErr };

  const result = endTurn(state);
  matches.set(result.state.id, result.state);
  markVisitClosedForTakeout(result.state);
  emit({
    type: "dart_detected",
    data: {
      state: result.state,
      callout: result.callout ?? "NEXT",
      turnEnded: true,
    },
  });
  emit({ type: "match_update", data: result.state });
  return { ok: true, state: result.state, callout: result.callout };
}

export type CameraCorrectDart = {
  kind: SegmentKind;
  number: number;
  angle?: number;
  radius?: number;
  confidence?: number;
  timestamp?: number;
};

/**
 * Replace the open visit with the exact dart list from Autodarts (or UI).
 * Idempotent: same list → same scores; used for mid-visit corrections.
 */
export function applyCameraCorrect(opts: {
  matchId?: string;
  roomId?: string;
  darts: CameraCorrectDart[];
  reason?: string;
  expectedPlayerIndex?: number;
}):
  | { ok: true; state: GameState; callout?: string; turnEnded: boolean }
  | { ok: false; error: string } {
  const state = resolveMatch({ matchId: opts.matchId, roomId: opts.roomId });
  if (!state) return { ok: false, error: "No active match found" };
  if (state.status !== "playing" && state.status !== "leg_won" && state.status !== "match_won") {
    return { ok: false, error: `Match status is ${state.status}` };
  }
  if (state.status === "playing" && currentThrowerIsBot(state)) {
    return { ok: false, error: "Bot thrower - camera scoring paused" };
  }
  if (state.status === "playing") {
    const seatErr = seatLockRejected(state, opts.expectedPlayerIndex);
    if (seatErr) return { ok: false, error: seatErr };
  }

  const beforePlayer = state.currentPlayerIndex;
  const darts = (opts.darts ?? []).slice(0, 3).map((d) =>
    createDart(d.kind, d.number, {
      angle: d.angle,
      radius: d.radius,
      source: "camera",
      timestamp: d.timestamp,
    })
  );

  // Defense: after auto end-turn the next thrower's visit is empty. A non-empty
  // correct here is almost always the prior player's Autodarts list bleeding
  // onto the new seat (takeout / residual throws). Empty correct = clear OK.
  if (
    state.status === "playing" &&
    state.currentTurnDarts.length === 0 &&
    darts.length > 0
  ) {
    return {
      ok: false,
      error: "No open visit - refusing correct onto next thrower",
    };
  }

  if (state.status === "playing" && darts.length > 0) {
    const takeoutErr = takeoutBlocksNewVisit(state, opts.roomId);
    if (takeoutErr) return { ok: false, error: takeoutErr };
  }

  // Empty list = clear open visit (undo all current-turn darts) without advancing.
  // A full 3-dart rewrite is a completed visit — auto-end like applyDart so
  // 41 / Baseball cannot sit on "Turn full" and freeze the thrower.
  const result = correctCurrentTurn(state, darts, {
    autoEnd: darts.length >= 3,
  });
  matches.set(result.state.id, result.state);

  const turnEnded =
    result.state.currentPlayerIndex !== beforePlayer ||
    result.state.status !== "playing" ||
    (darts.length > 0 && result.state.currentTurnDarts.length === 0);

  if (state.status === "playing") {
    if (turnEnded) {
      markVisitClosedForTakeout(result.state);
    } else if (result.state.currentTurnDarts.length > 0) {
      markVisitOpen(result.state);
    } else {
      clearTakeoutHold(normRoom(result.state.roomId || "Board 1"));
    }
  }

  emit({
    type: "dart_detected",
    data: {
      state: result.state,
      callout: result.callout ?? "CORRECTED",
      turnEnded,
      corrected: true,
      reason: opts.reason,
    },
  });
  emit({ type: "match_update", data: result.state });

  return {
    ok: true,
    state: result.state,
    callout: result.callout,
    turnEnded,
  };
}

/**
 * Step backward one dart (same engine undo as /play).
 * Reverses camera or manual scores already applied on the server match.
 */
export function applyCameraUndo(opts: {
  matchId?: string;
  roomId?: string;
}):
  | { ok: true; state: GameState; callout?: string }
  | { ok: false; error: string } {
  const state = resolveMatch({ matchId: opts.matchId, roomId: opts.roomId });
  if (!state) return { ok: false, error: "No active match found" };
  if (
    state.status !== "playing" &&
    state.status !== "leg_won" &&
    state.status !== "match_won"
  ) {
    return { ok: false, error: `Match status is ${state.status}` };
  }
  if (!canUndo(state)) {
    return { ok: false, error: "Nothing to undo" };
  }

  const result = undo(state);
  matches.set(result.state.id, result.state);
  // Undo reopens / shrinks the visit. Clear hold only when AD is not still
  // in takeout — live takeout must keep Reset takeout on /play.
  const room = normRoom(result.state.roomId || "Board 1");
  if (result.state.currentTurnDarts.length > 0) {
    markVisitOpen(result.state);
  } else if (!isLiveTakeoutSignal(getCameraHealth(room))) {
    clearTakeoutHold(room);
  }
  emit({
    type: "dart_detected",
    data: {
      state: result.state,
      callout: result.callout ?? "UNDO",
      turnEnded: false,
      undone: true,
    },
  });
  emit({ type: "match_update", data: result.state });
  return { ok: true, state: result.state, callout: result.callout };
}

export function setCameraHealth(health: CameraHealth): CameraHealth {
  const room = normRoom(health.roomId || "Board 1");
  const offline = isCameraBridgeOffline(health);
  // Never persist sticky takeout:true while AD/bridge is unreachable or stale.
  const rawTakeout = healthIndicatesTakeout(health);
  const candidate: CameraHealth = {
    ...health,
    roomId: room,
    takeout: rawTakeout,
    connected: offline ? false : health.connected,
    ts: health.ts || Date.now(),
  };
  const takeoutActive = !offline && isLiveTakeoutSignal(candidate);
  const next: CameraHealth = {
    ...candidate,
    takeout: takeoutActive,
    level: takeoutActive
      ? candidate.level || "takeout"
      : candidate.level === "takeout"
        ? offline
          ? "unhealthy"
          : "ok"
        : candidate.level,
    reason:
      offline && rawTakeout
        ? "board_manager_offline"
        : !takeoutActive && rawTakeout && isStaleCameraHealth(candidate)
          ? "takeout_stale_cleared"
          : candidate.reason,
  };
  cameraHealthByRoom.set(room, next);
  // Also index case-insensitive lookup key
  cameraHealthByRoom.set(room.toLowerCase(), next);
  const gate = getCameraGate(room);
  // Companion freeze alone is not enough - arm server next-seat hold whenever
  // live takeout health is active so camera darts are rejected until Ready/clear.
  // Offline / unreachable / stale AD must always release sticky hold (sandbox).
  if (offline || (!takeoutActive && rawTakeout)) {
    clearTakeoutHold(room);
  } else if (takeoutActive) {
    gate.holdUntilTakeoutClear = true;
  } else if (
    next.reason === "takeout_cleared" ||
    /ready for next visit/i.test(next.message || "")
  ) {
    // Bridge cleared takeout / Ready - release next-seat scoring hold
    // (Do not clear on ordinary "Cameras healthy" heartbeats.)
    gate.holdUntilTakeoutClear = false;
  }
  const stamped = stampHoldOnHealth(next, room);
  emit({ type: "camera_health", data: stamped });
  return stamped;
}

/**
 * Patron / staff ack: "darts pulled - ready for next visit" (bridge consumes).
 * Bound to the match + visit that was current when Ready was posted. A leftover
 * Ready from End game / a previous visit must not end-turn the next open visit.
 */
type TakeoutReadyAck = {
  ts: number;
  matchId: string | null;
  visitToken: string;
};

const takeoutReadyByRoom = new Map<string, TakeoutReadyAck>();

function takeoutVisitBinding(roomId: string): {
  matchId: string | null;
  visitToken: string;
} {
  const match = getActiveByRoom(roomId);
  if (!match) return { matchId: null, visitToken: "none" };
  return {
    matchId: match.id,
    visitToken: [
      match.id,
      match.legNumber ?? 1,
      match.setNumber ?? 1,
      match.turns?.length ?? 0,
      match.currentPlayerIndex,
      match.currentTurnDarts?.length ?? 0,
    ].join(":"),
  };
}

function readTakeoutReady(roomId: string): TakeoutReadyAck | null {
  const room = normRoom(roomId);
  return (
    takeoutReadyByRoom.get(room) ??
    takeoutReadyByRoom.get(room.toLowerCase()) ??
    null
  );
}

function writeTakeoutReady(roomId: string, ack: TakeoutReadyAck): void {
  const room = normRoom(roomId);
  takeoutReadyByRoom.set(room, ack);
  takeoutReadyByRoom.set(room.toLowerCase(), ack);
}

function clearTakeoutReady(roomId: string): void {
  const room = normRoom(roomId);
  takeoutReadyByRoom.delete(room);
  takeoutReadyByRoom.delete(room.toLowerCase());
}

function takeoutReadyIsLive(roomId: string, ack: TakeoutReadyAck): boolean {
  const live = takeoutVisitBinding(roomId);
  return ack.matchId === live.matchId && ack.visitToken === live.visitToken;
}

export function requestTakeoutReady(roomId: string): {
  roomId: string;
  ts: number;
  matchId: string | null;
  visitToken: string;
} {
  const room = normRoom(roomId);
  const ts = Date.now();
  const binding = takeoutVisitBinding(room);
  writeTakeoutReady(room, { ts, ...binding });
  // Clear stuck Pull-darts banner + next-seat hold (bridge + UI must agree)
  clearTakeoutHold(room);
  const prev = getCameraHealth(room);
  setCameraHealth({
    roomId: room,
    ok: true,
    level: "ok",
    message: "Ready for next visit",
    reason: "takeout_cleared",
    takeout: false,
    status: prev?.status || "",
    fps: prev?.fps || [],
    minFps: prev?.minFps ?? null,
    cameras: prev?.cameras || [],
    connected: prev?.connected ?? true,
    unhealthyForS: 0,
    restarting: false,
    ts,
  });
  emit({
    type: "takeout_ready",
    data: {
      roomId: room,
      ts,
      matchId: binding.matchId,
      visitToken: binding.visitToken,
    },
  });
  return { roomId: room, ts, matchId: binding.matchId, visitToken: binding.visitToken };
}

export function peekTakeoutReady(roomId: string): number | null {
  const room = normRoom(roomId);
  const ack = readTakeoutReady(room);
  if (!ack) return null;
  if (!takeoutReadyIsLive(room, ack)) {
    clearTakeoutReady(room);
    return null;
  }
  return ack.ts;
}

/** Bridge poll: return pending ts and clear it when consume=true. */
export function consumeTakeoutReady(
  roomId: string,
  consume: boolean
): {
  pending: boolean;
  ts: number | null;
  roomId: string;
  matchId: string | null;
  visitToken: string | null;
} {
  const room = normRoom(roomId);
  const ack = readTakeoutReady(room);
  if (!ack || !takeoutReadyIsLive(room, ack)) {
    if (ack) clearTakeoutReady(room);
    return { pending: false, ts: null, roomId: room, matchId: null, visitToken: null };
  }
  if (consume) clearTakeoutReady(room);
  return {
    pending: true,
    ts: ack.ts,
    roomId: room,
    matchId: ack.matchId,
    visitToken: ack.visitToken,
  };
}

function stampHoldOnHealth(health: CameraHealth, roomId: string): CameraHealth {
  const gate = getCameraGate(roomId);
  return {
    ...health,
    holdUntilTakeoutClear: gate.holdUntilTakeoutClear,
  };
}

export function getCameraHealth(roomId?: string): CameraHealth | undefined {
  if (roomId) {
    reconcileStaleTakeout(roomId);
    const exact = cameraHealthByRoom.get(roomId);
    if (exact) return stampHoldOnHealth(exact, normRoom(roomId));
    const lower = cameraHealthByRoom.get(roomId.trim().toLowerCase());
    if (lower) return stampHoldOnHealth(lower, normRoom(roomId));
    for (const h of cameraHealthByRoom.values()) {
      if ((h.roomId || "").trim().toLowerCase() === roomId.trim().toLowerCase()) {
        return stampHoldOnHealth(h, normRoom(h.roomId || roomId));
      }
    }
    return undefined;
  }
  // Sole / most recent
  let latest: CameraHealth | undefined;
  for (const h of cameraHealthByRoom.values()) {
    if (!latest || (h.ts ?? 0) > (latest.ts ?? 0)) latest = h;
  }
  if (latest?.roomId) reconcileStaleTakeout(latest.roomId);
  const resolved = latest?.roomId
    ? cameraHealthByRoom.get(normRoom(latest.roomId)) ?? latest
    : latest;
  return resolved?.roomId
    ? stampHoldOnHealth(resolved, normRoom(resolved.roomId))
    : resolved;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: { type: string; data: unknown }) {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // ignore
    }
  }
}

export function checkCameraAuth(request: Request): boolean {
  const key = process.env.CAMERA_API_KEY;
  if (!key) return true; // open in dev / local
  const header = request.headers.get("authorization") || request.headers.get("x-api-key");
  if (!header) return false;
  if (header === key) return true;
  if (header.startsWith("Bearer ") && header.slice(7) === key) return true;
  return false;
}
