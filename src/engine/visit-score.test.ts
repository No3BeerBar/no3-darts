import { describe, expect, it } from "vitest";
import { applyDart, createDart, createGame } from "@/engine";
import {
  baseballVisitTotalFromDarts,
  dartPointsForMode,
  visitPointsFromTurn,
} from "./visit-score";

describe("visitPointsFromTurn — Baseball", () => {
  it("BULL BULL BULL visit totals 0 (not 150)", () => {
    const bulls = [
      createDart("bull", 50),
      createDart("bull", 50),
      createDart("bull", 50),
    ];
    // Raw dart.value sum would be 150 — mode scoring must be 0
    expect(bulls.reduce((a, d) => a + d.value, 0)).toBe(150);
    expect(baseballVisitTotalFromDarts(bulls, 1)).toBe(0);
    expect(
      visitPointsFromTurn("baseball", {
        playerId: "p1",
        darts: bulls,
        startScore: 0,
        endScore: 0,
        bust: false,
        checkout: false,
        timestamp: 1,
      })
    ).toBe(0);
  });

  it("uses endScore − startScore for a scoring inning visit", () => {
    const darts = [
      createDart("single", 4),
      createDart("double", 4),
      createDart("triple", 20),
    ];
    // Inning 4: 4 + 8 + 0 = 12
    expect(baseballVisitTotalFromDarts(darts, 4)).toBe(12);
    expect(
      visitPointsFromTurn("baseball", {
        playerId: "p1",
        darts,
        startScore: 10,
        endScore: 22,
        bust: false,
        checkout: false,
        timestamp: 1,
      })
    ).toBe(12);
  });

  it("engine-recorded turn matches visit helper after three bulls", () => {
    let state = createGame({
      modeConfig: { mode: "baseball", config: { innings: 9 } },
      players: [
        { id: "p1", name: "Alice", isGuest: true },
        { id: "p2", name: "Bob", isGuest: true },
      ],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
    state = applyDart(state, createDart("bull", 50)).state;
    state = applyDart(state, createDart("bull", 50)).state;
    state = applyDart(state, createDart("bull", 50)).state;
    // Turn auto-ended
    const turn = state.turns[0];
    expect(turn).toBeDefined();
    expect(visitPointsFromTurn("baseball", turn)).toBe(0);
    expect(baseballVisitTotalFromDarts(turn.darts, 1)).toBe(0);
    expect(turn.endScore - turn.startScore).toBe(0);
  });
});

describe("dartPointsForMode — Baseball", () => {
  it("scores only the inning number", () => {
    expect(dartPointsForMode("baseball", createDart("triple", 4), { inning: 4 })).toBe(
      12
    );
    expect(dartPointsForMode("baseball", createDart("bull", 50), { inning: 4 })).toBe(0);
    expect(dartPointsForMode("baseball", createDart("triple", 20), { inning: 4 })).toBe(
      0
    );
  });
});

describe("visitPointsFromTurn — X01 still uses dart sum", () => {
  it("sums dart.value on a normal visit", () => {
    const darts = [
      createDart("triple", 20),
      createDart("triple", 20),
      createDart("triple", 20),
    ];
    expect(
      visitPointsFromTurn("x01", {
        playerId: "p1",
        darts,
        startScore: 501,
        endScore: 321,
        bust: false,
        checkout: false,
        timestamp: 1,
      })
    ).toBe(180);
  });

  it("bust → 0", () => {
    expect(
      visitPointsFromTurn("x01", {
        playerId: "p1",
        darts: [createDart("triple", 20)],
        startScore: 40,
        endScore: 40,
        bust: true,
        checkout: false,
        timestamp: 1,
      })
    ).toBe(0);
  });
});
