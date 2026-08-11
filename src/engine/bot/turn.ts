/**
 * Pure helpers for bot turn automation (testable without React timers).
 */

import { isBotPlayer } from "./profiles";
import type { GameState } from "../types";

/** Pause before the first dart of a bot visit. */
export const BOT_TURN_START_DELAY_MS = 700;
/** Gap between darts in a visit. */
export const BOT_BETWEEN_DARTS_MS = 850;

export type BotTurnPlan =
  | { action: "idle" }
  | { action: "throw"; delayMs: number; playerId: string };

/**
 * Decide whether the scoring UI should schedule a bot dart.
 * Cancel whenever status leaves `playing` or the thrower is human.
 */
export function planBotTurn(state: GameState | null | undefined): BotTurnPlan {
  if (!state || state.status !== "playing") return { action: "idle" };
  const player = state.players[state.currentPlayerIndex];
  if (!player || !isBotPlayer(player)) return { action: "idle" };
  const delayMs =
    state.currentTurnDarts.length === 0
      ? BOT_TURN_START_DELAY_MS
      : BOT_BETWEEN_DARTS_MS;
  return { action: "throw", delayMs, playerId: player.id };
}
