/**
 * Push active client match state to the server so TV / camera can find it.
 */

import type { GameState } from "@/engine/types";
import { isHeartbeatMatchStatus } from "@/lib/live-match";

/** Bumped on End game so in-flight heartbeat POSTs are dropped. */
let matchSyncEpoch = 0;
let heartbeatAbort: AbortController | null = null;

export function getMatchSyncEpoch(): number {
  return matchSyncEpoch;
}

/** Abort in-flight tablet heartbeats before DELETE so they cannot revive the match. */
export function stopMatchSync(): void {
  matchSyncEpoch += 1;
  heartbeatAbort?.abort();
  heartbeatAbort = null;
}

export async function syncMatchToServer(
  state: GameState,
  opts?: { signal?: AbortSignal; epoch?: number; force?: boolean }
): Promise<boolean> {
  if (!opts?.force && opts?.epoch != null && opts.epoch !== matchSyncEpoch) {
    return false;
  }
  try {
    // Always ensure roomId is present for TV lookup
    const payload = {
      state: {
        ...state,
        roomId: state.roomId || "Board 1",
        updatedAt: state.updatedAt || Date.now(),
      },
    };
    const r = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: opts?.signal,
    });
    if (!opts?.force && opts?.epoch != null && opts.epoch !== matchSyncEpoch) {
      return false;
    }
    return r.ok;
  } catch {
    return false;
  }
}

/** Drop the room's live match so `/tv` returns to attract (finish or abandon). */
export async function clearMatchFromServer(
  matchId: string,
  lastState?: GameState | null
): Promise<void> {
  stopMatchSync();
  // Finished upsert tombstones immediately (even if DELETE is slow).
  if (lastState) {
    await syncMatchToServer(
      {
        ...lastState,
        status: "finished",
        updatedAt: Date.now(),
      },
      { force: true }
    );
  }
  const del = () =>
    fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
      method: "DELETE",
      cache: "no-store",
    });
  try {
    const r = await del();
    if (!r.ok) await del();
  } catch {
    try {
      await del();
    } catch {
      /* offline — tombstone from finished POST still applies when it lands */
    }
  }
}

/** Fire-and-forget keepalive used by the scoring tablet */
export function startMatchHeartbeat(
  getState: () => GameState | null,
  intervalMs = 3000
): () => void {
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const s = getState();
    if (!s || !isHeartbeatMatchStatus(s.status)) return;
    const epoch = matchSyncEpoch;
    heartbeatAbort?.abort();
    heartbeatAbort = new AbortController();
    const ac = heartbeatAbort;
    void syncMatchToServer(s, { signal: ac.signal, epoch });
  };

  // Immediate push so TV can reconnect right away
  tick();
  const id = window.setInterval(tick, intervalMs);

  const onVis = () => {
    if (document.visibilityState === "visible") tick();
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("online", tick);
  window.addEventListener("focus", tick);

  return () => {
    stopped = true;
    heartbeatAbort?.abort();
    heartbeatAbort = null;
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("online", tick);
    window.removeEventListener("focus", tick);
  };
}
