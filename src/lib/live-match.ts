import type { GameState, GameStatus } from "@/engine/types";

/** Statuses the TV may show as a live match (including a brief winner screen). */
export function isLiveMatchStatus(
  status: GameStatus | undefined
): status is "playing" | "paused" | "leg_won" | "match_won" {
  return (
    status === "playing" ||
    status === "paused" ||
    status === "leg_won" ||
    status === "match_won"
  );
}

/**
 * Tablet keepalive while scoring. `match_won` is excluded so End game /
 * autosave can drop the room without a heartbeat resurrecting it.
 */
export function isHeartbeatMatchStatus(status: GameStatus | undefined): boolean {
  return status === "playing" || status === "paused" || status === "leg_won";
}

/** In-progress scoring only — not the winner screen (used for sole-room fallback). */
export function isScoringLiveStatus(status: GameStatus | undefined): boolean {
  return isHeartbeatMatchStatus(status);
}

export function isLiveMatch(match: GameState | null | undefined): match is GameState {
  return Boolean(match && isLiveMatchStatus(match.status));
}
