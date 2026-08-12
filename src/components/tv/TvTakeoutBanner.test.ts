/**
 * Contract coverage for the prominent TV takeout banner (John watches /tv).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");

function readSrc(...parts: string[]) {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

describe("TvTakeoutBanner", () => {
  it("is a large impossible-to-miss Removing darts + Reset status", () => {
    const banner = readSrc("src/components/tv/TvTakeoutBanner.tsx");
    expect(banner).toContain('"use client"');
    expect(banner).toMatch(/export function TvTakeoutBanner/);
    expect(banner).toMatch(/if \(!active\) return null/);
    expect(banner).toMatch(/Removing darts/);
    expect(banner).toMatch(/Reset/);
    expect(banner).toMatch(/scoring tablet/);
    expect(banner).toMatch(/data-testid=["']tv-takeout-banner["']/);
    expect(banner).toMatch(/text-4xl|text-5xl|text-6xl/);
    expect(banner).toMatch(/animate-pulse/);
  });

  it("TvDisplay mounts the banner from live takeout feed state", () => {
    const tv = readSrc("src/components/tv/TvDisplay.tsx");
    expect(tv).toMatch(/TvTakeoutBanner/);
    expect(tv).toMatch(/takeoutActive/);
    expect(tv).toMatch(/takeoutMessage/);
    // Attract + live match both show the banner (TV watched more than iPad)
    expect(tv).toMatch(/takeoutBanner/);
  });

  it("TV feed gates takeout on isLiveTakeoutSignal (no sandbox spam)", () => {
    const feed = readSrc("src/hooks/useTvMatchFeed.ts");
    expect(feed).toMatch(/isLiveTakeoutSignal/);
    expect(feed).toMatch(/setTakeoutActive\(true\)/);
    expect(feed).toMatch(/setTakeoutActive\(false\)/);
    expect(feed).toMatch(/\/api\/camera\/health/);
    // Must not treat raw takeout flags without live-signal gate
    expect(feed).not.toMatch(
      /setCameraNotice\(h\.message \|\| ["']Pull darts/
    );
  });
});
