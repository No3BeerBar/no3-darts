/**
 * Cheap contract coverage for TakeoutBanner without a React JSX transform
 * in vitest (tsconfig jsx:preserve). Asserts the patron-visible Reset path
 * stays wired in source (bartender-proof).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "TakeoutBanner.tsx"),
  "utf8"
);

describe("TakeoutBanner", () => {
  it("is a client component with Reset control while takeout is active", () => {
    expect(SRC).toContain('"use client"');
    expect(SRC).toMatch(/export function TakeoutBanner/);
    expect(SRC).toMatch(/if \(!active\) return null/);
    expect(SRC).toMatch(/onReady/);
    expect(SRC).toMatch(/busy \? ["']Resetting/);
    expect(SRC).toMatch(/: ["']Reset["']/);
    expect(SRC).toMatch(/disabled=\{busy\}/);
    expect(SRC).toMatch(/onClick=\{onReady\}/);
  });

  it("tells patrons camera scoring is paused and to pull darts", () => {
    expect(SRC).toMatch(/Removing darts/);
    expect(SRC).toMatch(/takeout/i);
    expect(SRC).toMatch(/Camera scoring paused/);
    expect(SRC).toMatch(/Pull your darts/);
    expect(SRC).toMatch(/tap Reset/);
  });
});
