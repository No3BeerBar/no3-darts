import { describe, expect, it } from "vitest";
import {
  isFromPlaySearch,
  sanitizePlayBack,
  statsHrefFromPlay,
} from "./play-kiosk";

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
});
