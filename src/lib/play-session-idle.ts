/**
 * Tablet session idle logout for the play kiosk.
 *
 * John's rules (exact):
 * 1. Not in a match → auto sign everyone out after 2 minutes of inactivity.
 * 2. In a match (playing / paused / between legs) → leave signed in (no idle
 *    logout mid-match; thinking time between darts is fine).
 * 3. After match ends / they stop playing → start the 2-minute inactivity
 *    timer again; then sign out.
 *
 * Activity on the play/setup surface resets the timer while armed.
 */

import type { GameState } from "@/engine";

/** Inactivity while not mid-match before forcing re-PIN (2 minutes). */
export const PLAY_SESSION_IDLE_MS = 2 * 60 * 1000;

export const PLAY_SESSION_ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "pointerdown",
  "touchstart",
  "keydown",
  "scroll",
  "wheel",
];

/**
 * True while a match is still in progress for idle-logout purposes.
 * - playing / paused / leg_won → mid-match (rule 2): do not arm.
 * - match_won / finished / setup / null → match over or absent (rules 1 & 3): arm.
 */
export function isMidMatchForSessionIdle(
  state: GameState | null | undefined
): boolean {
  if (!state) return false;
  return (
    state.status === "playing" ||
    state.status === "paused" ||
    state.status === "leg_won"
  );
}

/**
 * True when the tablet should arm the 2-minute session idle timer.
 * Only on setup `/` and `/play`. Mid-match never arms; idle and post-match do.
 */
export function shouldArmPlaySessionIdle(
  pathname: string,
  state: GameState | null | undefined
): boolean {
  if (pathname !== "/" && pathname !== "/play") return false;
  return !isMidMatchForSessionIdle(state);
}

/** Pure helper for tests: given last activity + now, should we logout? */
export function playSessionIdleExpired(
  lastActivityAt: number,
  now: number,
  idleMs: number = PLAY_SESSION_IDLE_MS
): boolean {
  return now - lastActivityAt >= idleMs;
}
