import { describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import { buildStoredMatch, modeDisplayLabel } from "./match-export";

describe("buildStoredMatch — mode labels + finalScore", () => {
  it("labels 41 matches as 41 and persists finishing scores", () => {
    const state = createGame({
      modeConfig: { mode: "forty_one", config: {} },
      players: [
        { id: "p1", name: "Alice", isGuest: false },
        { id: "p2", name: "Bob", isGuest: false },
      ],
    });
    expect(modeDisplayLabel(state)).toBe("41");
    const stored = buildStoredMatch(state);
    expect(stored.mode).toBe("forty_one");
    expect(stored.modeLabel).toBe("41");
    expect(stored.summary.playerStats[0].finalScore).toBe(60);
    expect(stored.summary.playerStats[1].finalScore).toBe(60);
  });

  it("labels Baseball matches with display name", () => {
    const state = createGame({
      modeConfig: { mode: "baseball", config: { innings: 9 } },
      players: [{ id: "p1", name: "Alice", isGuest: true }],
    });
    const stored = buildStoredMatch(state);
    expect(stored.mode).toBe("baseball");
    expect(stored.modeLabel).toBe("Baseball");
    expect(stored.summary.playerStats[0].finalScore).toBe(0);
  });

  it("keeps X01 start score as modeLabel", () => {
    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: true },
      },
      players: [{ id: "p1", name: "Alice", isGuest: true }],
    });
    expect(buildStoredMatch(state).modeLabel).toBe("501");
  });
});
