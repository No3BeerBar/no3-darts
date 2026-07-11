"use client";

/**
 * Optional: listen for server-side dart events (camera) and merge into local game.
 * Enable when using CV software against the same Railway instance.
 */

import { useEffect } from "react";
import type { GameState } from "@/engine/types";
import { useGameStore } from "@/store/game-store";

export function useCameraSync(enabled = true) {
  const setState = useGameStore((s) => s.setState);
  const local = useGameStore((s) => s.state);

  useEffect(() => {
    if (!enabled || !local) return;

    let es: EventSource | null = null;
    let cancelled = false;

    try {
      es = new EventSource("/api/camera/stream");
    } catch {
      return;
    }

    const onDart = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as {
          state?: GameState;
          callout?: string;
        };
        if (!data.state) return;
        // Only apply if same match
        if (data.state.id !== useGameStore.getState().state?.id) return;
        // Prefer server if it has more darts / newer timestamp
        const cur = useGameStore.getState().state;
        if (!cur) return;
        if (data.state.updatedAt >= cur.updatedAt) {
          setState(data.state);
          if (data.callout) {
            useGameStore.setState({ lastCallout: data.callout });
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    const onMatch = (ev: MessageEvent) => {
      try {
        const state = JSON.parse(ev.data) as GameState;
        const cur = useGameStore.getState().state;
        if (!cur || state.id !== cur.id) return;
        if (state.updatedAt > cur.updatedAt) setState(state);
      } catch {
        // ignore
      }
    };

    es.addEventListener("dart_detected", onDart);
    es.addEventListener("match_update", onMatch);

    return () => {
      cancelled = true;
      es?.close();
      void cancelled;
    };
    // Reconnect when match id changes; `local` intentionally not fully listed
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only rebind on match id
  }, [enabled, local?.id, setState]);
}
