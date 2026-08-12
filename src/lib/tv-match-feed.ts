/**
 * Pure TV idle / attract helpers. The hook in `useTvMatchFeed` must not
 * postpone idle every poll — that used to orphan the last match on HDMI forever.
 */

import type { GameState } from "@/engine/types";
import { isLiveMatchStatus } from "@/lib/live-match";

export { isLiveMatchStatus as isLiveTvStatus };

/** TV poll interval for `GET /api/matches/active`. */
export const TV_ACTIVE_POLL_MS = 1500;

/**
 * After the last live sighting, wait this long before attract.
 * Must be ≤ a couple of poll cycles so End game flips HDMI within ~3–5s.
 */
export const IDLE_GRACE_MS = 2500;

/** Brief winner linger, then attract even if the same match_won is still polled. */
export const MATCH_WON_ATTRACT_MS = 3500;

export function remainingIdleGraceMs(
  lastSeenLiveAt: number | null,
  now: number,
  graceMs = IDLE_GRACE_MS
): number {
  if (lastSeenLiveAt == null) return 0;
  return Math.max(0, graceMs - (now - lastSeenLiveAt));
}

/**
 * Empty / non-live active poll. Delay is remaining grace from last live
 * sighting — never a fresh full grace (that would never fire while polling).
 */
export function idleAfterEmptyActivePoll(opts: {
  lastSeenLiveAt: number | null;
  now: number;
  graceMs?: number;
}): { goIdle: true } | { goIdle: false; delayMs: number } {
  const delayMs = remainingIdleGraceMs(
    opts.lastSeenLiveAt,
    opts.now,
    opts.graceMs
  );
  if (delayMs <= 0) return { goIdle: true };
  return { goIdle: false, delayMs };
}

export function shouldApplyLiveMatch(
  match: GameState | null | undefined,
  dismissedWonMatchId: string | null
): match is GameState {
  if (!match || !isLiveMatchStatus(match.status)) return false;
  if (match.status === "match_won" && dismissedWonMatchId === match.id) {
    return false;
  }
  return true;
}

/** Start the winner→attract timer once per match id (do not reset on polls). */
export function shouldStartMatchWonAttractTimer(opts: {
  matchStatus: GameState["status"];
  matchId: string;
  timerMatchId: string | null;
}): boolean {
  return opts.matchStatus === "match_won" && opts.timerMatchId !== opts.matchId;
}

/**
 * Repeated identical `match_won` polls must not extend idle grace or restart
 * the attract timer (that is what stuck HDMI on the winner screen forever).
 */
export function shouldRefreshLiveSighting(opts: {
  status: GameState["status"];
  matchId: string;
  lingerMatchId: string | null;
}): boolean {
  if (opts.status === "match_won" && opts.lingerMatchId === opts.matchId) {
    return false;
  }
  return true;
}

/** Prefer the sooner idle deadline; never postpone an already-scheduled one. */
export function nextIdleDeadline(
  existingDeadline: number | null,
  proposedFireAt: number
): number | null {
  if (existingDeadline == null) return proposedFireAt;
  return Math.min(existingDeadline, proposedFireAt);
}
