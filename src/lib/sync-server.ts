/**
 * Push active client match state to the server so TV / camera can find it.
 */

import type { GameState } from "@/engine/types";

export async function syncMatchToServer(state: GameState): Promise<boolean> {
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
      // avoid browser caching intermediate responses
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
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
    if (
      s &&
      (s.status === "playing" ||
        s.status === "paused" ||
        s.status === "leg_won" ||
        s.status === "match_won")
    ) {
      void syncMatchToServer(s);
    }
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
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("online", tick);
    window.removeEventListener("focus", tick);
  };
}
