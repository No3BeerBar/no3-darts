import { describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import {
  PLAY_SESSION_IDLE_MS,
  playSessionIdleExpired,
  shouldArmPlaySessionIdle,
} from "./play-session-idle";

function match(status: "playing" | "paused" | "leg_won" | "match_won" | "finished") {
  const g = createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    players: [{ id: "p1", name: "A", isGuest: true }],
  });
  return { ...g, status };
}

describe("play session idle logout", () => {
  it("arms only on setup / idle play when no match is active", () => {
    expect(shouldArmPlaySessionIdle("/play", null)).toBe(true);
    expect(shouldArmPlaySessionIdle("/", null)).toBe(true);
    expect(shouldArmPlaySessionIdle("/play", match("finished"))).toBe(true);

    expect(shouldArmPlaySessionIdle("/play", match("playing"))).toBe(false);
    expect(shouldArmPlaySessionIdle("/", match("paused"))).toBe(false);
    expect(shouldArmPlaySessionIdle("/play", match("leg_won"))).toBe(false);
    expect(shouldArmPlaySessionIdle("/play", match("match_won"))).toBe(false);

    expect(shouldArmPlaySessionIdle("/leaderboard", null)).toBe(false);
    expect(shouldArmPlaySessionIdle("/tv", null)).toBe(false);
  });

  it("expires after 2 minutes of inactivity", () => {
    const t0 = 1_000_000;
    expect(playSessionIdleExpired(t0, t0 + PLAY_SESSION_IDLE_MS - 1)).toBe(false);
    expect(playSessionIdleExpired(t0, t0 + PLAY_SESSION_IDLE_MS)).toBe(true);
  });
});
