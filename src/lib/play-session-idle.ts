/**
 * Tablet session idle logout for the play kiosk.
 *
 * When the tablet is on idle play / setup (not mid-match), inactivity longer
 * than PLAY_SESSION_IDLE_MS signs everyone out so the next game needs PIN again.
 * Activity on the play surface resets the timer. Mid-match thinking time never
 * triggers logout.
 */

import type { GameState } from "@/engine";

/** Inactivity while not in a match before forcing re-PIN (2 minutes). */
export const PLAY_SESSION_IDLE_MS = 2 * 60 * 1000;

export const PLAY_SESSION_ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "pointerdown",
  "touchstart",
  "keydown",
  "scroll",
  "wheel",
];

/**
 * True when the tablet should arm the 2-minute session idle timer.
 * - Idle `/play` (no active match) and setup `/` without a resumable match.
 * - Not during active scoring / pause / leg or match win banners.
 */
export function shouldArmPlaySessionIdle(
  pathname: string,
  state: GameState | null | undefined
): boolean {
  if (pathname !== "/" && pathname !== "/play") return false;
  if (!state) return true;
  return (
    state.status !== "playing" &&
    state.status !== "paused" &&
    state.status !== "leg_won" &&
    state.status !== "match_won"
  );
}

/** Pure helper for tests: given last activity + now, should we logout? */
export function playSessionIdleExpired(
  lastActivityAt: number,
  now: number,
  idleMs: number = PLAY_SESSION_IDLE_MS
): boolean {
  return now - lastActivityAt >= idleMs;
}
