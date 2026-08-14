import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "@/engine";
import {
  IDLE_GRACE_MS,
  MATCH_RESULT_HOLD_MS,
  MATCH_WON_ATTRACT_MS,
  TV_ACTIVE_POLL_MS,
  idleAfterEmptyActivePoll,
  nextIdleDeadline,
  remainingIdleGraceMs,
  resultHoldRemainingMs,
  shouldApplyLiveMatch,
  shouldCancelResultHold,
  shouldHoldOnMatchRemoved,
  shouldRefreshLiveSighting,
  shouldStartMatchWonAttractTimer,
} from "./tv-match-feed";
import { isHeartbeatMatchStatus, isLiveMatchStatus } from "./live-match";

function match(status: GameState["status"]): GameState {
  const state = createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    players: [
      { id: "a", name: "Alice", isGuest: true },
      { id: "b", name: "Bob", isGuest: true },
    ],
    roomId: "Board 1",
  });
  return { ...state, status };
}

describe("TV live vs attract", () => {
  it("treats playing/paused/leg_won/match_won as live, not finished", () => {
    expect(isLiveMatchStatus("playing")).toBe(true);
    expect(isLiveMatchStatus("paused")).toBe(true);
    expect(isLiveMatchStatus("leg_won")).toBe(true);
    expect(isLiveMatchStatus("match_won")).toBe(true);
    expect(isLiveMatchStatus("finished")).toBe(false);
    expect(isLiveMatchStatus("setup")).toBe(false);
  });

  it("does not heartbeat match_won (so End game / autosave can clear the room)", () => {
    expect(isHeartbeatMatchStatus("playing")).toBe(true);
    expect(isHeartbeatMatchStatus("leg_won")).toBe(true);
    expect(isHeartbeatMatchStatus("match_won")).toBe(false);
    expect(isHeartbeatMatchStatus("finished")).toBe(false);
  });

  it("empty polls do not postpone idle past last live sighting + grace", () => {
    const lastSeen = 1_000_000;
    const pollEvery = TV_ACTIVE_POLL_MS;
    // Old bug: each empty poll scheduled a fresh 8s timer, so attract never fired.
    let now = lastSeen + pollEvery;
    for (let i = 0; i < 20; i++) {
      const decision = idleAfterEmptyActivePoll({
        lastSeenLiveAt: lastSeen,
        now,
        graceMs: IDLE_GRACE_MS,
      });
      if (now - lastSeen >= IDLE_GRACE_MS) {
        expect(decision).toEqual({ goIdle: true });
      } else {
        expect(decision.goIdle).toBe(false);
        if (!decision.goIdle) {
          expect(decision.delayMs).toBe(IDLE_GRACE_MS - (now - lastSeen));
        }
      }
      now += pollEvery;
    }
    expect(remainingIdleGraceMs(lastSeen, lastSeen + IDLE_GRACE_MS)).toBe(0);
    expect(IDLE_GRACE_MS).toBeLessThanOrEqual(5_000);
    expect(IDLE_GRACE_MS).toBeGreaterThanOrEqual(pollEvery);
  });

  it("goes idle immediately when no live match was ever seen", () => {
    expect(
      idleAfterEmptyActivePoll({ lastSeenLiveAt: null, now: Date.now() })
    ).toEqual({ goIdle: true });
  });

  it("never postpones an earlier idle deadline", () => {
    expect(nextIdleDeadline(100, 200)).toBe(100);
    expect(nextIdleDeadline(null, 200)).toBe(200);
    expect(nextIdleDeadline(300, 200)).toBe(200);
  });

  it("starts match_won attract once per match and ignores later polls of the same win", () => {
    const won = match("match_won");
    expect(
      shouldStartMatchWonAttractTimer({
        matchStatus: won.status,
        matchId: won.id,
        timerMatchId: null,
      })
    ).toBe(true);
    expect(
      shouldStartMatchWonAttractTimer({
        matchStatus: won.status,
        matchId: won.id,
        timerMatchId: won.id,
      })
    ).toBe(false);
    expect(
      shouldRefreshLiveSighting({
        status: "match_won",
        matchId: won.id,
        lingerMatchId: won.id,
      })
    ).toBe(false);
    expect(
      shouldRefreshLiveSighting({
        status: "playing",
        matchId: won.id,
        lingerMatchId: null,
      })
    ).toBe(true);
    expect(shouldApplyLiveMatch(won, null)).toBe(true);
    expect(shouldApplyLiveMatch(won, won.id)).toBe(false);
    expect(shouldApplyLiveMatch(match("playing"), won.id)).toBe(true);
    expect(shouldApplyLiveMatch(match("finished"), null)).toBe(false);
    expect(MATCH_RESULT_HOLD_MS).toBe(30_000);
    expect(MATCH_WON_ATTRACT_MS).toBe(MATCH_RESULT_HOLD_MS);
  });

  it("holds the last result ~30s after match end before idle", () => {
    const endedAt = 5_000_000;
    const mid = idleAfterEmptyActivePoll({
      lastSeenLiveAt: endedAt,
      now: endedAt + 10_000,
      resultEndedAt: endedAt,
    });
    expect(mid.goIdle).toBe(false);
    if (!mid.goIdle) {
      expect(mid.delayMs).toBe(MATCH_RESULT_HOLD_MS - 10_000);
    }
    expect(
      idleAfterEmptyActivePoll({
        lastSeenLiveAt: endedAt,
        now: endedAt + MATCH_RESULT_HOLD_MS,
        resultEndedAt: endedAt,
      })
    ).toEqual({ goIdle: true });
    expect(resultHoldRemainingMs(endedAt, endedAt + 1_000)).toBe(29_000);
  });

  it("skips the result hold when a new live match can apply", () => {
    const won = match("match_won");
    const next = match("playing");
    expect(shouldApplyLiveMatch(next, won.id)).toBe(true);
    expect(shouldApplyLiveMatch(won, won.id)).toBe(false);
    expect(
      shouldCancelResultHold({
        matchStatus: "playing",
        matchId: next.id,
        lingerMatchId: won.id,
      })
    ).toBe(true);
    expect(
      shouldCancelResultHold({
        matchStatus: "match_won",
        matchId: won.id,
        lingerMatchId: won.id,
      })
    ).toBe(false);
  });

  it("does not idle a new match when the previous game is removed", () => {
    expect(
      shouldHoldOnMatchRemoved({
        removedMatchId: "old",
        currentMatchId: "new",
        lastSeenLiveAt: 1,
      })
    ).toBe(false);
    expect(
      shouldHoldOnMatchRemoved({
        removedMatchId: "old",
        currentMatchId: "old",
        lastSeenLiveAt: 1,
      })
    ).toBe(true);
    expect(
      shouldHoldOnMatchRemoved({
        removedMatchId: "old",
        currentMatchId: "old",
        lastSeenLiveAt: null,
      })
    ).toBe(false);
  });

  it("TV feed holds last result 30s and does not idle on 1.5s match_removed", () => {
    const hook = readFileSync(join(__dirname, "../hooks/useTvMatchFeed.ts"), "utf8");
    expect(hook).toMatch(/MATCH_RESULT_HOLD_MS/);
    expect(hook).toMatch(/beginResultHold/);
    expect(hook).toMatch(/resultEndedAt/);
    expect(hook).toMatch(/shouldHoldOnMatchRemoved/);
    expect(hook).toMatch(/shouldCancelResultHold/);
    expect(hook).not.toMatch(/scheduleIdle\(1_500/);
    expect(hook).not.toMatch(/scheduleIdle\(1500/);
  });
});
