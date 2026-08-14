import { describe, expect, it } from "vitest";
import { playBoardSide, tvBoardSide } from "./board-stage-size";

describe("tvBoardSide (HDMI leftover column)", () => {
  it("uses the full leftover square — no 720 stay-put cap", () => {
    // 1080p: ~1280×992 leftover after a 640px score column + header
    expect(tvBoardSide(1280, 992)).toBe(984);
    expect(tvBoardSide(1280, 992)).toBeGreaterThan(720);
  });

  it("is width-limited when the column is narrow", () => {
    expect(tvBoardSide(700, 1000)).toBe(692);
  });
});

describe("playBoardSide (iPad reserved cell, no postage-stamp cap)", () => {
  it("fills the leftover square — no 440 max-size", () => {
    expect(playBoardSide(800, 800)).toBe(788);
    expect(playBoardSide(800, 800)).toBeGreaterThan(440);
    expect(playBoardSide(500, 360)).toBe(348);
  });

  it("floors at 200", () => {
    expect(playBoardSide(180, 180)).toBe(200);
  });
});
