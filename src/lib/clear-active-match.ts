/**
 * Shared rules for abandoning an in-progress tablet match
 * (End game on `/play`, Cancel on resume card at `/`).
 *
 * Clearing always goes through `useGameStore.clearGame()` which removes
 * `no3_active_game` + seat-auth. Native `window.confirm` must not gate this —
 * use the in-app ConfirmDialog on kiosk.
 */

import type { GameState } from "@/engine";
import { matchScoringStarted } from "@/lib/play-kiosk";

/** True when discarding should ask the patron first (scoring already happened). */
export function needsAbandonConfirm(state: GameState | null | undefined): boolean {
  return Boolean(state && matchScoringStarted(state));
}

/**
 * Decide whether to open the confirm UI or clear immediately.
 * Returns `"confirm"` | `"clear"`.
 */
export function abandonMatchAction(
  state: GameState | null | undefined
): "confirm" | "clear" {
  return needsAbandonConfirm(state) ? "confirm" : "clear";
}

/** Patron Play must not surface Start tournament match unless staff unlocked. */
export function canShowTournamentLaneStart(staffUnlocked: boolean): boolean {
  return staffUnlocked;
}
