/**
 * End-of-match auto-save helpers for `/play`.
 * When a match is won, persist per existing rules and return to idle — no Save dialog.
 */

import type { GameState } from "@/engine";
import { MATCH_RESULT_HOLD_MS } from "@/lib/tv-match-feed";

/** Hold the winner on /play for the same ~30s as HDMI, then idle. */
export const MATCH_WON_AUTOSAVE_MS = MATCH_RESULT_HOLD_MS;

export function shouldAutoSaveMatch(state: GameState | null | undefined): boolean {
  return state?.status === "match_won";
}
