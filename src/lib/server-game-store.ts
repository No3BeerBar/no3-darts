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
  isCameraBridgeOffline,
  isLiveTakeoutSignal,
  isStaleCameraHealth,
  type CameraHealth,
} from "@/lib/camera-health";

export type { CameraHealth } from "@/lib/camera-health";
export {
  isCameraBridgeOffline,
  isLiveTakeoutSignal,
  isStaleCameraHealth,
  CAMERA_HEALTH_FRESH_MS,
} from "@/lib/camera-health";

type Listener = (event: { type: string; data: unknown }) => void;

const matches = new Map<string, GameState>();
const byRoom = new Map<string, string>(); // roomId -> matchId
const listeners = new Set<Listener>();

/** Latest camera / Board Manager health per room (from companion bridge). */
const cameraHealthByRoom = new Map<string, CameraHealth>();

export function upsertServerMatch(state: GameState): void {
  // Finished matches leave the live registry so TV returns to attract.
  if (state.status === "finished" || state.status === "setup") {
    removeServerMatch(state.id);
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
  if (state.roomId) byRoom.set(state.roomId, state.id);
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

export function getActiveByRoom(roomId: string): GameState | undefined {
  // Exact room key
  const id = byRoom.get(roomId);
  if (id) {
    const m = matches.get(id);
    if (m) return m;
  }
  // Case-insensitive / trimmed fallback
  const want = roomId.trim().toLowerCase();
  for (const m of matches.values()) {
    if ((m.roomId || "").trim().toLowerCase() === want) return m;
  }
  // If only one live match exists, return it (helps after room rename mismatch)
  const live = listServerMatches().filter(
    (m) =>
      m.status === "playing" ||
      m.status === "paused" ||
      m.status === "leg_won" ||
      m.status === "match_won"
  );
  if (live.length === 1) return live[0];
  return undefined;
}

export function listServerMatches(): GameState[] {
  return Array.from(matches.values());
}

export function removeServerMatch(id: string): void {
  const m = matches.get(id);
  if (m?.roomId) {
    byRoom.delete(m.roomId);
    clearTakeoutHold(m.roomId);
  }
  matches.delete(id);
  emit({ type: "match_removed", data: { id } });
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
  // Do not clear a takeout-armed hold while health still says takeout -
  // empty-visit reject must stay fail-closed even mid-APPEND of dart 3.
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

  const hadTakeout =
    Boolean(health.takeout) ||
    health.level === "takeout" ||
    health.reason === "takeout";
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
    gate.openVisitSeat = next.currentPlayerIndex;
    gate.holdUntilTakeoutClear = false;
    return;
  }
  if (prev && countProgress(next) < countProgress(prev)) {
    // Progress went backward (Undo) with empty open visit - allow rescoring
    gate.holdUntilTakeoutClear = false;
    gate.openVisitSeat = null;
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

  const dart = createDart(event.kind, event.number, {
    angle: event.angle,
    radius: event.radius,
    source: "camera",
    timestamp: event.timestamp,
  });

  const result = applyDart(state, dart);
  matches.set(result.state.id, result.state);
  const turnEnded =
    result.state.currentPlayerIndex !== beforePlayer ||
    (beforeTurnLen + 1 >= 3 && result.state.currentTurnDarts.length === 0) ||
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

  // Empty list = clear open visit (undo all current-turn darts) without advancing
  const result = correctCurrentTurn(state, darts, { autoEnd: false });
  matches.set(result.state.id, result.state);

  const turnEnded =
    result.state.currentPlayerIndex !== beforePlayer ||
    result.state.status !== "playing";

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
  // Undo reopens / shrinks the visit - clear takeout hold so camera can score
  if (result.state.currentTurnDarts.length > 0) {
    markVisitOpen(result.state);
  } else {
    clearTakeoutHold(normRoom(result.state.roomId || "Board 1"));
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
  const rawTakeout =
    Boolean(health.takeout) ||
    health.level === "takeout" ||
    health.reason === "takeout";
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
  emit({ type: "camera_health", data: next });
  return next;
}

/** Patron / staff ack: "darts pulled - ready for next visit" (bridge consumes). */
const takeoutReadyByRoom = new Map<string, number>();

export function requestTakeoutReady(roomId: string): { roomId: string; ts: number } {
  const room = normRoom(roomId);
  const ts = Date.now();
  takeoutReadyByRoom.set(room, ts);
  takeoutReadyByRoom.set(room.toLowerCase(), ts);
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
  emit({ type: "takeout_ready", data: { roomId: room, ts } });
  return { roomId: room, ts };
}

export function peekTakeoutReady(roomId: string): number | null {
  const room = normRoom(roomId);
  return (
    takeoutReadyByRoom.get(room) ??
    takeoutReadyByRoom.get(room.toLowerCase()) ??
    null
  );
}

/** Bridge poll: return pending ts and clear it when consume=true. */
export function consumeTakeoutReady(
  roomId: string,
  consume: boolean
): { pending: boolean; ts: number | null; roomId: string } {
  const room = normRoom(roomId);
  const ts = peekTakeoutReady(room);
  if (ts != null && consume) {
    takeoutReadyByRoom.delete(room);
    takeoutReadyByRoom.delete(room.toLowerCase());
  }
  return { pending: ts != null, ts, roomId: room };
}

export function getCameraHealth(roomId?: string): CameraHealth | undefined {
  if (roomId) {
    reconcileStaleTakeout(roomId);
    const exact = cameraHealthByRoom.get(roomId);
    if (exact) return exact;
    const lower = cameraHealthByRoom.get(roomId.trim().toLowerCase());
    if (lower) return lower;
    for (const h of cameraHealthByRoom.values()) {
      if ((h.roomId || "").trim().toLowerCase() === roomId.trim().toLowerCase()) {
        return h;
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
  return latest?.roomId
    ? cameraHealthByRoom.get(normRoom(latest.roomId)) ?? latest
    : latest;
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
