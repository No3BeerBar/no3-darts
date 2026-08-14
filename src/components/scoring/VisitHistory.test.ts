/**
 * Recent visits must always name the thrower — not a tiny unlabeled dart list.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(__dirname, "VisitHistory.tsx"), "utf8");
const PLAY = readFileSync(join(__dirname, "ScoringScreen.tsx"), "utf8");
const TV = readFileSync(join(__dirname, "../tv/TvDisplay.tsx"), "utf8");

describe("VisitHistory thrower labels", () => {
  it("labels each visit and each listed dart with who threw", () => {
    expect(SRC).toMatch(/visitThrowerName/);
    expect(SRC).toMatch(/visitThrowerLabel/);
    expect(SRC).toMatch(/data-testid=["']recent-visit-thrower["']/);
    expect(SRC).toMatch(/data-testid=["']recent-visit-dart["']/);
    expect(SRC).toMatch(/\{thrower\}/);
    expect(SRC).not.toMatch(/h-\[4\.5rem\]/);
  });

  it("is mounted on iPad /play and HDMI /tv", () => {
    expect(PLAY).toMatch(/VisitHistory/);
    expect(TV).toMatch(/VisitHistory/);
  });
});
