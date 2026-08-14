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
 * After a true idle (no result to hold), wait this long before attract.
 * Must stay short so a board that never had a match does not look stuck.
 */
export const IDLE_GRACE_MS = 2500;

/**
 * Keep the last result on HDMI (~30s) after match_won or End game, then attract.
 * A new live match skips this immediately. Not configurable.
 */
export const MATCH_RESULT_HOLD_MS = 30_000;

/** @deprecated use MATCH_RESULT_HOLD_MS — same 30s winner/result linger. */
export const MATCH_WON_ATTRACT_MS = MATCH_RESULT_HOLD_MS;

export function remainingIdleGraceMs(
  lastSeenLiveAt: number | null,
  now: number,
  graceMs = IDLE_GRACE_MS
): number {
  if (lastSeenLiveAt == null) return 0;
  return Math.max(0, graceMs - (now - lastSeenLiveAt));
}

/** Time left on the post-match result hold (0 if none / expired). */
export function resultHoldRemainingMs(
  endedAt: number | null,
  now: number,
  holdMs = MATCH_RESULT_HOLD_MS
): number {
  if (endedAt == null) return 0;
  return Math.max(0, holdMs - (now - endedAt));
}

/**
 * Empty / non-live active poll. Delay is remaining grace from last live
 * sighting — never a fresh full grace (that would never fire while polling).
 */
export function idleAfterEmptyActivePoll(opts: {
  lastSeenLiveAt: number | null;
  now: number;
  graceMs?: number;
  /** First time we noticed match_won / End game on this feed. */
  resultEndedAt?: number | null;
  resultHoldMs?: number;
}): { goIdle: true } | { goIdle: false; delayMs: number } {
  const holdMs = resultHoldRemainingMs(
    opts.resultEndedAt ?? null,
    opts.now,
    opts.resultHoldMs
  );
  if (holdMs > 0) return { goIdle: false, delayMs: holdMs };

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

/**
 * A new in-progress match skips the 30s result hold immediately.
 * Persist / leftover updates of the same finished match must not reset it.
 */
export function shouldCancelResultHold(opts: {
  matchStatus: GameState["status"];
  matchId: string;
  lingerMatchId: string | null;
}): boolean {
  if (opts.matchStatus === "match_won") return false;
  if (opts.matchStatus === "playing") return true;
  if (opts.lingerMatchId != null && opts.matchId !== opts.lingerMatchId) {
    return true;
  }
  return false;
}

/**
 * `match_removed` starts/continues the result hold only for the match on
 * screen. A new live match must not be idled by the previous game's DELETE.
 */
export function shouldHoldOnMatchRemoved(opts: {
  removedMatchId?: string | null;
  currentMatchId: string | null;
  lastSeenLiveAt: number | null;
}): boolean {
  if (opts.lastSeenLiveAt == null) return false;
  if (
    opts.removedMatchId &&
    opts.currentMatchId &&
    opts.removedMatchId !== opts.currentMatchId
  ) {
    return false;
  }
  return true;
}
