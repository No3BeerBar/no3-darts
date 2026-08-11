import { describe, expect, it } from "vitest";
import type { GameModeId } from "@/engine";
import { listModes } from "@/engine";
import { HOW_TO_PLAY, getHowToPlay } from "./how-to-play";

const ALL_MODES: GameModeId[] = [
  "x01",
  "cricket",
  "shanghai",
  "countup",
  "around_the_clock",
  "bermuda",
  "random_checkout",
  "killer",
  "baseball",
  "forty_one",
];

describe("how-to-play", () => {
  it("covers every engine mode", () => {
    const engineIds = listModes().map((m) => m.id).sort();
    expect(Object.keys(HOW_TO_PLAY).sort()).toEqual(engineIds);
    for (const mode of ALL_MODES) {
      const guide = getHowToPlay(mode);
      expect(guide.mode).toBe(mode);
      expect(guide.title.length).toBeGreaterThan(0);
      expect(guide.summary.length).toBeGreaterThan(10);
      expect(guide.sections.length).toBeGreaterThanOrEqual(3);
      for (const section of guide.sections) {
        expect(section.title.length).toBeGreaterThan(0);
        expect(section.body.length).toBeGreaterThan(20);
      }
    }
  });

  it("documents John rules for Baseball, 41, and Killer", () => {
    const baseball = getHowToPlay("baseball");
    expect(baseball.sections.some((s) => /inning/i.test(s.body))).toBe(true);
    expect(baseball.sections.some((s) => /bull/i.test(s.body))).toBe(true);

    const fortyOne = getHowToPlay("forty_one");
    expect(fortyOne.sections.some((s) => /exact 41/i.test(s.body))).toBe(true);
    expect(fortyOne.sections.some((s) => /halv/i.test(s.body))).toBe(true);
    expect(fortyOne.sections.some((s) => /all 3/i.test(s.body))).toBe(true);

    const killer = getHowToPlay("killer");
    expect(killer.sections.some((s) => /double/i.test(s.body))).toBe(true);
    expect(killer.sections.some((s) => /life|lives/i.test(s.body))).toBe(true);
  });
});
