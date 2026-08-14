/**
 * Who won the match — TV / iPad winner hold copy.
 */

import { teamDisplayName, type GameState } from "@/engine";

/** Obvious winner name (or team) for match_won. Null if there is no winner yet. */
export function matchWinnerLabel(state: GameState | null | undefined): string | null {
  if (!state) return null;
  const id = state.winnerTeamId ?? state.winnerId;
  if (!id) return null;
  const name = teamDisplayName(state, id);
  return name && name !== "—" ? name : null;
}

export function isMatchWinnerHold(state: GameState | null | undefined): boolean {
  return state?.status === "match_won";
}
