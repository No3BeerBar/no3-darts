/**
 * End-of-match auto-save helpers for `/play`.
 * When a match is won, persist per existing rules and return to idle — no Save dialog.
 */

import type { GameState } from "@/engine";

/** Brief pause so patrons see the MATCH winner before returning to idle. */
export const MATCH_WON_AUTOSAVE_MS = 1600;

export function shouldAutoSaveMatch(state: GameState | null | undefined): boolean {
  return state?.status === "match_won";
}
