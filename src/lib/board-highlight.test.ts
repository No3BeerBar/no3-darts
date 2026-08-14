import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDart } from "@/engine";
import {
  HIT_FLASH_MS,
  dartMatchesSegment,
  isObjectiveSegment,
  lastDartKey,
  lastVisitDart,
  segmentPaintRole,
} from "./board-highlight";

describe("board target vs last-hit highlight", () => {
  it("keeps the objective when a different section is hit", () => {
    expect(
      isObjectiveSegment("single", 16, { focusNumber: 16, focusKind: "wedge" })
    ).toBe(true);
    expect(
      isObjectiveSegment("single", 8, { focusNumber: 16, focusKind: "wedge" })
    ).toBe(false);
    expect(
      segmentPaintRole({
        isObjective: true,
        isLastHit: false,
        hitFlashActive: true,
      })
    ).toBe("target");
    expect(
      segmentPaintRole({
        isObjective: false,
        isLastHit: true,
        hitFlashActive: true,
      })
    ).toBe("hit");
    expect(
      segmentPaintRole({
        isObjective: false,
        isLastHit: true,
        hitFlashActive: false,
      })
    ).toBe("base");
  });

  it("shows target + hit-on-target together when they land the aim", () => {
    expect(
      segmentPaintRole({
        isObjective: true,
        isLastHit: true,
        hitFlashActive: true,
      })
    ).toBe("hitOnTarget");
    expect(
      segmentPaintRole({
        isObjective: true,
        isLastHit: true,
        hitFlashActive: false,
      })
    ).toBe("target");
  });

  it("any-double / killer double-only / bull stay objective-locked", () => {
    expect(
      isObjectiveSegment("double", 8, { focusRing: "double" })
    ).toBe(true);
    expect(
      isObjectiveSegment("single", 8, { focusRing: "double" })
    ).toBe(false);
    expect(
      isObjectiveSegment("double", 16, {
        focusNumber: 16,
        focusKind: "double",
      })
    ).toBe(true);
    expect(
      isObjectiveSegment("single", 16, {
        focusNumber: 16,
        focusKind: "double",
      })
    ).toBe(false);
    expect(isObjectiveSegment("bull", 50, { focusBull: true })).toBe(true);
    expect(isObjectiveSegment("single", 16, { focusBull: true })).toBe(false);
  });

  it("last visit dart is the hit, not every mark in the visit", () => {
    const eight = createDart("single", 8);
    const sixteen = createDart("single", 16);
    const marks = [eight, sixteen];
    expect(lastVisitDart(marks)?.id).toBe(sixteen.id);
    expect(dartMatchesSegment(lastVisitDart(marks), "single", 16)).toBe(true);
    expect(dartMatchesSegment(lastVisitDart(marks), "single", 8)).toBe(false);
    expect(lastDartKey(sixteen)).toContain(sixteen.id);
    expect(HIT_FLASH_MS).toBe(1100);
  });

  it("Dartboard never paints last-hit gold over the target", () => {
    const src = readFileSync(
      join(__dirname, "../components/board/Dartboard.tsx"),
      "utf8"
    );
    expect(src).toMatch(/segmentPaintRole/);
    expect(src).toMatch(/HIT_FLASH/);
    expect(src).toMatch(/board-hit-flash/);
    expect(src).not.toMatch(/if \(isLit\(kind, num\)\) return lit/);
    expect(src).toMatch(/isObjectiveSegment/);
  });
});
