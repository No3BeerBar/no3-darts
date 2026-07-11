/**
 * In-memory server-side match registry for camera / REST integration.
 * Clients can push active match state here; camera posts darts against matchId.
 * For multi-instance Railway, swap for Redis later.
 */

import type { DartDetectedEvent, GameState } from "@/engine/types";
import { applyDart, createDart } from "@/engine";

type Listener = (event: { type: string; data: unknown }) => void;

const matches = new Map<string, GameState>();
const byRoom = new Map<string, string>(); // roomId -> matchId
const listeners = new Set<Listener>();

export function upsertServerMatch(state: GameState): void {
  matches.set(state.id, state);
  if (state.roomId) byRoom.set(state.roomId, state.id);
  emit({ type: "match_update", data: state });
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
  if (m?.roomId) byRoom.delete(m.roomId);
  matches.delete(id);
  emit({ type: "match_removed", data: { id } });
}

export function applyCameraDart(
  event: DartDetectedEvent
): { ok: true; state: GameState; callout?: string } | { ok: false; error: string } {
  let state: GameState | undefined;
  if (event.matchId) state = matches.get(event.matchId);
  else if (event.roomId) state = getActiveByRoom(event.roomId);
  else {
    // Use most recent playing match
    state = listServerMatches().find((m) => m.status === "playing");
  }

  if (!state) return { ok: false, error: "No active match found" };
  if (state.status !== "playing") return { ok: false, error: `Match status is ${state.status}` };

  const dart = createDart(event.kind, event.number, {
    angle: event.angle,
    radius: event.radius,
    source: "camera",
    timestamp: event.timestamp,
  });

  const result = applyDart(state, dart);
  matches.set(result.state.id, result.state);
  emit({
    type: "dart_detected",
    data: { dart, state: result.state, callout: result.callout, confidence: event.confidence },
  });

  return { ok: true, state: result.state, callout: result.callout };
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
