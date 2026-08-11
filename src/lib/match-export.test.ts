import { describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import {
  buildStoredMatch,
  hasRegisteredPlayers,
  modeDisplayLabel,
} from "./match-export";

describe("buildStoredMatch — mode labels + finalScore", () => {
  it("labels 41 matches as 41 and persists finishing scores for registered players", () => {
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
    expect(stored.summary.playerStats).toHaveLength(2);
    expect(stored.summary.playerStats[0].finalScore).toBe(60);
    expect(stored.summary.playerStats[1].finalScore).toBe(60);
    expect(hasRegisteredPlayers(stored)).toBe(true);
  });

  it("labels Baseball matches with display name", () => {
    const state = createGame({
      modeConfig: { mode: "baseball", config: { innings: 9 } },
      players: [{ id: "p1", name: "Alice", isGuest: false }],
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
      players: [{ id: "p1", name: "Alice", isGuest: false }],
    });
    expect(buildStoredMatch(state).modeLabel).toBe("501");
  });
});

describe("guest privacy — no history / scores for guests", () => {
  it("guest-only 41 match has no playerStats and is not recordable", () => {
    const state = createGame({
      modeConfig: { mode: "forty_one", config: {} },
      players: [
        { id: "g1", name: "Walk-up", isGuest: true },
        { id: "g2", name: "Friend", isGuest: true },
      ],
    });
    const stored = buildStoredMatch(state);
    expect(stored.players.every((p) => p.isGuest)).toBe(true);
    expect(stored.summary.playerStats).toEqual([]);
    expect(hasRegisteredPlayers(stored)).toBe(false);
  });

  it("mixed match keeps stats only for the registered player", () => {
    const state = createGame({
      modeConfig: { mode: "baseball", config: { innings: 9 } },
      players: [
        { id: "reg1", name: "Pat", isGuest: false },
        { id: "g1", name: "Guest", isGuest: true },
      ],
    });
    const stored = buildStoredMatch(state);
    expect(hasRegisteredPlayers(stored)).toBe(true);
    expect(stored.summary.playerStats).toHaveLength(1);
    expect(stored.summary.playerStats[0].playerId).toBe("reg1");
    expect(stored.summary.playerStats[0].name).toBe("Pat");
  });
});
