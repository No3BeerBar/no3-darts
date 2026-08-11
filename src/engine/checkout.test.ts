import { describe, expect, it } from "vitest";
import {
  formatCheckoutDescription,
  getCheckoutSuggestion,
  isCheckoutPossible,
} from "./checkout";

describe("checkout suggestions", () => {
  it("returns preferred double-out path for common finishes", () => {
    const s = getCheckoutSuggestion(170, 3, true);
    expect(s?.description).toBe("T20 T20 BULL");
    expect(s?.darts).toHaveLength(3);

    expect(getCheckoutSuggestion(40, 3, true)?.description).toBe("D20");
    expect(getCheckoutSuggestion(32, 1, true)?.description).toBe("D16");
    expect(getCheckoutSuggestion(121, 3, true)?.description).toBe("T20 T11 D14");
  });

  it("hides bogey numbers that cannot be checked out", () => {
    for (const n of [169, 168, 166, 165, 163, 162, 159]) {
      expect(getCheckoutSuggestion(n, 3, true)).toBeNull();
      expect(isCheckoutPossible(n, 3, true)).toBe(false);
    }
  });

  it("returns null above 170 or below a finish", () => {
    expect(getCheckoutSuggestion(171, 3, true)).toBeNull();
    expect(getCheckoutSuggestion(1, 3, true)).toBeNull();
    expect(getCheckoutSuggestion(0, 3, true)).toBeNull();
  });

  it("still shows the preferred route when fewer darts remain than ideal", () => {
    // 170 needs 3; with 2 left still surface the table route for the thrower
    const s = getCheckoutSuggestion(170, 2, true);
    expect(s?.description).toBe("T20 T20 BULL");
  });

  it("respects straight-out when doubleOut is false", () => {
    const s = getCheckoutSuggestion(60, 1, false);
    expect(s?.description).toBe("T20");
  });

  it("formats paths without arrows for iPad readability", () => {
    expect(formatCheckoutDescription([{ label: "T20" }, { label: "D10" }])).toBe("T20 D10");
  });
});
