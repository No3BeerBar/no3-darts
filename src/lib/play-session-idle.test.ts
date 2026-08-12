import { describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import type { GameStatus } from "@/engine/types";
import {
  PLAY_SESSION_IDLE_MS,
  isMidMatchForSessionIdle,
  playSessionIdleExpired,
  shouldArmPlaySessionIdle,
} from "./play-session-idle";

function match(status: GameStatus) {
  const g = createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    players: [{ id: "p1", name: "A", isGuest: true }],
  });
  return { ...g, status };
}

describe("play session idle logout (John's rules)", () => {
  it("rule 1: not in a match → arm 2-min idle on setup and idle /play", () => {
    expect(shouldArmPlaySessionIdle("/play", null)).toBe(true);
    expect(shouldArmPlaySessionIdle("/", null)).toBe(true);
    expect(isMidMatchForSessionIdle(null)).toBe(false);

    // Stale / terminal blobs still count as not mid-match
    expect(shouldArmPlaySessionIdle("/play", match("finished"))).toBe(true);
    expect(shouldArmPlaySessionIdle("/", match("setup"))).toBe(true);
  });

  it("rule 2: in a match (playing) → do not idle-logout mid-match", () => {
    expect(isMidMatchForSessionIdle(match("playing"))).toBe(true);
    expect(shouldArmPlaySessionIdle("/play", match("playing"))).toBe(false);
    expect(shouldArmPlaySessionIdle("/", match("playing"))).toBe(false);

    // Pause / between legs are still mid-match (thinking time, bathroom break)
    expect(shouldArmPlaySessionIdle("/play", match("paused"))).toBe(false);
    expect(shouldArmPlaySessionIdle("/play", match("leg_won"))).toBe(false);
    expect(isMidMatchForSessionIdle(match("paused"))).toBe(true);
    expect(isMidMatchForSessionIdle(match("leg_won"))).toBe(true);
  });

  it("rule 3: after match ends → start the 2-min timer again", () => {
    // match_won = match just ended — arm immediately (not only after idle clear)
    expect(isMidMatchForSessionIdle(match("match_won"))).toBe(false);
    expect(shouldArmPlaySessionIdle("/play", match("match_won"))).toBe(true);

    // End game / autosave → null idle play also arms
    expect(shouldArmPlaySessionIdle("/play", null)).toBe(true);
    expect(shouldArmPlaySessionIdle("/", null)).toBe(true);

    // Transition playing → match_won flips armed off → on
    expect(shouldArmPlaySessionIdle("/play", match("playing"))).toBe(false);
    expect(shouldArmPlaySessionIdle("/play", match("match_won"))).toBe(true);
    expect(shouldArmPlaySessionIdle("/play", null)).toBe(true);
  });

  it("does not arm on non-play surfaces", () => {
    expect(shouldArmPlaySessionIdle("/leaderboard", null)).toBe(false);
    expect(shouldArmPlaySessionIdle("/tv", null)).toBe(false);
    expect(shouldArmPlaySessionIdle("/admin", match("finished"))).toBe(false);
  });

  it("expires after exactly 2 minutes of inactivity", () => {
    const t0 = 1_000_000;
    expect(playSessionIdleExpired(t0, t0 + PLAY_SESSION_IDLE_MS - 1)).toBe(false);
    expect(playSessionIdleExpired(t0, t0 + PLAY_SESSION_IDLE_MS)).toBe(true);
    expect(PLAY_SESSION_IDLE_MS).toBe(2 * 60 * 1000);
  });
});
