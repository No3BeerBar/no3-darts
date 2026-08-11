import { describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import {
  isFromPlaySearch,
  matchScoringStarted,
  sanitizePlayBack,
  statsHrefFromPlay,
} from "./play-kiosk";

function freshMatch() {
  return createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    players: [{ id: "p1", name: "A", isGuest: true }],
  });
}

describe("play-kiosk", () => {
  it("builds a stats href tagged from play", () => {
    expect(statsHrefFromPlay("/play")).toBe("/leaderboard?from=play&back=%2Fplay");
    expect(statsHrefFromPlay("/")).toBe("/leaderboard?from=play&back=%2F");
  });

  it("sanitizes back paths", () => {
    expect(sanitizePlayBack("/play")).toBe("/play");
    expect(sanitizePlayBack("/")).toBe("/");
    expect(sanitizePlayBack("/admin")).toBe("/");
    expect(sanitizePlayBack(null)).toBe("/");
  });

  it("detects from=play search params", () => {
    const params = new URLSearchParams("from=play&back=/play");
    expect(isFromPlaySearch((k) => params.get(k))).toEqual({
      fromPlay: true,
      back: "/play",
    });
    expect(isFromPlaySearch(() => null)).toEqual({ fromPlay: false, back: "/" });
  });

  it("detects when match scoring has started", () => {
    const fresh = freshMatch();
    expect(matchScoringStarted(fresh)).toBe(false);

    expect(
      matchScoringStarted({
        ...fresh,
        currentTurnDarts: [
          {
            id: "d1",
            kind: "single",
            number: 20,
            value: 20,
            timestamp: 1,
          },
        ],
      })
    ).toBe(true);

    expect(matchScoringStarted({ ...fresh, legNumber: 2 })).toBe(true);
    expect(matchScoringStarted({ ...fresh, status: "match_won" })).toBe(true);
  });
});
