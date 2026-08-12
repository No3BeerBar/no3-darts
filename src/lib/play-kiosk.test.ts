import { describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import {
  isFromPlaySearch,
  matchScoringStarted,
  playHref,
  sanitizePlayBack,
  setupHref,
  statsHrefFromPlay,
  withRoomQuery,
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
    expect(statsHrefFromPlay("/play")).toBe(
      "/leaderboard?from=play&back=%2Fplay",
    );
    expect(statsHrefFromPlay("/")).toBe("/leaderboard?from=play&back=%2F");
  });

  it("preserves room on play/setup hrefs and stats back", () => {
    expect(withRoomQuery("/play", "Board 1")).toBe("/play?room=Board+1");
    expect(playHref("Board 1")).toBe("/play?room=Board+1");
    expect(setupHref("Board 1")).toBe("/?room=Board+1");
    expect(playHref("")).toBe("/play");
    expect(playHref(null)).toBe("/play");
    expect(statsHrefFromPlay("/play", "Board 1")).toBe(
      "/leaderboard?from=play&back=%2Fplay%3Froom%3DBoard%2B1",
    );
  });

  it("sanitizes back paths and keeps only room query", () => {
    expect(sanitizePlayBack("/play")).toBe("/play");
    expect(sanitizePlayBack("/")).toBe("/");
    expect(sanitizePlayBack("/admin")).toBe("/");
    expect(sanitizePlayBack(null)).toBe("/");
    expect(sanitizePlayBack("/play?room=Board%201")).toBe("/play?room=Board+1");
    expect(sanitizePlayBack("/play?room=Board+1&evil=1")).toBe(
      "/play?room=Board+1",
    );
    expect(sanitizePlayBack("/play?evil=1")).toBe("/play");
  });

  it("detects from=play search params", () => {
    const params = new URLSearchParams("from=play&back=/play");
    expect(isFromPlaySearch((k) => params.get(k))).toEqual({
      fromPlay: true,
      back: "/play",
    });
    const withRoom = new URLSearchParams(
      "from=play&back=/play%3Froom%3DBoard%2B1",
    );
    expect(isFromPlaySearch((k) => withRoom.get(k))).toEqual({
      fromPlay: true,
      back: "/play?room=Board+1",
    });
    expect(isFromPlaySearch(() => null)).toEqual({
      fromPlay: false,
      back: "/",
    });
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
      }),
    ).toBe(true);

    expect(matchScoringStarted({ ...fresh, legNumber: 2 })).toBe(true);
    expect(matchScoringStarted({ ...fresh, status: "match_won" })).toBe(true);
  });
});
