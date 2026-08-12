import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "@/engine";
import {
  IDLE_GRACE_MS,
  MATCH_WON_ATTRACT_MS,
  TV_ACTIVE_POLL_MS,
  idleAfterEmptyActivePoll,
  nextIdleDeadline,
  remainingIdleGraceMs,
  shouldApplyLiveMatch,
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
    expect(shouldApplyLiveMatch(won, null)).toBe(true);
    expect(shouldApplyLiveMatch(won, won.id)).toBe(false);
    expect(shouldApplyLiveMatch(match("playing"), won.id)).toBe(true);
    expect(shouldApplyLiveMatch(match("finished"), null)).toBe(false);
    expect(MATCH_WON_ATTRACT_MS).toBeLessThanOrEqual(5_000);
  });
});
