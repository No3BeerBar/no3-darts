"use client";

/**
 * Keep the active tablet match registered on the server so the TV
 * can reconnect after deploys, refreshes, or network blips.
 */

import { useEffect } from "react";
import { useGameStore } from "@/store/game-store";
import { startMatchHeartbeat } from "@/lib/sync-server";

export function useMatchHeartbeat(enabled = true) {
  const displayOnly = useGameStore((s) => s.displayOnly);
  const matchId = useGameStore((s) => s.state?.id);
  const status = useGameStore((s) => s.state?.status);

  useEffect(() => {
    if (!enabled || displayOnly) return;
    if (!matchId) return;
    if (
      status !== "playing" &&
      status !== "paused" &&
      status !== "leg_won" &&
      status !== "match_won"
    ) {
      return;
    }

    const stop = startMatchHeartbeat(() => useGameStore.getState().state, 2500);
    return stop;
  }, [enabled, displayOnly, matchId, status]);
}
