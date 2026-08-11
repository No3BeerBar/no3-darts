/**
 * Kiosk helpers for the patron play flow (setup `/` + scoring `/play`).
 *
 * Secondary screens (e.g. leaderboard) opened from play use `?from=play&back=…`
 * so AppShell can show Back + idle-return without the full site nav.
 */

import type { GameState } from "@/engine";

export const PLAY_FROM_PARAM = "from";
export const PLAY_FROM_VALUE = "play";
export const PLAY_BACK_PARAM = "back";

/** Idle play landing (no match) — setup Cancel / End game return here. */
export const PLAY_IDLE_HREF = "/play";

/** Idle on secondary screens before returning to play (~45–60s). */
export const PLAY_SECONDARY_IDLE_MS = 50_000;

export type PlayBackPath = "/" | "/play";

export function isPlayBackPath(value: string | null | undefined): value is PlayBackPath {
  return value === "/" || value === "/play";
}

export function sanitizePlayBack(value: string | null | undefined): PlayBackPath {
  return isPlayBackPath(value) ? value : "/";
}

/** Leaderboard link from setup or scoring — marks the visit as from-play. */
export function statsHrefFromPlay(back: PlayBackPath): string {
  const q = new URLSearchParams({
    [PLAY_FROM_PARAM]: PLAY_FROM_VALUE,
    [PLAY_BACK_PARAM]: back,
  });
  return `/leaderboard?${q.toString()}`;
}

export function isFromPlaySearch(
  get: (key: string) => string | null
): { fromPlay: true; back: PlayBackPath } | { fromPlay: false; back: PlayBackPath } {
  const fromPlay = get(PLAY_FROM_PARAM) === PLAY_FROM_VALUE;
  const back = sanitizePlayBack(get(PLAY_BACK_PARAM));
  return fromPlay ? { fromPlay: true, back } : { fromPlay: false, back };
}

/** True once any dart / completed visit / later leg exists — used for End game confirm. */
export function matchScoringStarted(state: GameState): boolean {
  if (state.currentTurnDarts.length > 0) return true;
  if (state.turns.length > 0) return true;
  if (state.legNumber > 1 || state.setNumber > 1) return true;
  if (state.status === "leg_won" || state.status === "match_won") return true;
  return state.playerStates.some((p) => (p.dartsThrown ?? 0) > 0);
}
