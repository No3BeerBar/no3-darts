import { describe, expect, it } from "vitest";
import { applyDart, createGame, createDart } from "@/engine";
import {
  BASEBALL_INNINGS,
  baseballDartPoints,
  baseballInning,
  baseballVisitPoints,
} from "./baseball";

describe("baseballDartPoints — scoring table innings 1–9", () => {
  for (let n = 1; n <= 9; n++) {
    it(`inning ${n}: S${n}=${n}, D${n}=${n * 2}, T${n}=${n * 3}`, () => {
      expect(baseballDartPoints(createDart("single", n), n)).toBe(n * 1);
      expect(baseballDartPoints(createDart("double", n), n)).toBe(n * 2);
      expect(baseballDartPoints(createDart("triple", n), n)).toBe(n * 3);
    });

    it(`inning ${n}: wrong number / miss / bull = 0`, () => {
      const wrong = n === 9 ? 1 : n + 1;
      expect(baseballDartPoints(createDart("single", wrong), n)).toBe(0);
      expect(baseballDartPoints(createDart("double", wrong), n)).toBe(0);
      expect(baseballDartPoints(createDart("triple", wrong), n)).toBe(0);
      expect(baseballDartPoints(createDart("miss", 0), n)).toBe(0);
      expect(baseballDartPoints(createDart("outer_bull", 25), n)).toBe(0);
      expect(baseballDartPoints(createDart("bull", 50), n)).toBe(0);
    });
  }

  it("examples from rules: inning 1 and 9", () => {
    expect(baseballDartPoints(createDart("single", 1), 1)).toBe(1);
    expect(baseballDartPoints(createDart("double", 1), 1)).toBe(2);
    expect(baseballDartPoints(createDart("triple", 1), 1)).toBe(3);
    expect(baseballDartPoints(createDart("single", 9), 9)).toBe(9);
    expect(baseballDartPoints(createDart("double", 9), 9)).toBe(18);
    expect(baseballDartPoints(createDart("triple", 9), 9)).toBe(27);
  });
});

describe("baseball engine play", () => {
  function start() {
    return createGame({
      modeConfig: { mode: "baseball", config: { innings: 9 } },
      players: [
        { id: "p1", name: "Alice", isGuest: true },
        { id: "p2", name: "Bob", isGuest: true },
      ],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
  }

  it("starts at inning 1 targeting 1", () => {
    const state = start();
    expect(state.mode).toBe("baseball");
    expect(baseballInning(state)).toBe(1);
    expect(state.roundIndex).toBe(0);
  });

  it("adds S/D/T points only for the inning number", () => {
    let state = start();
    state = applyDart(state, createDart("single", 1)).state;
    expect(state.playerStates[0].score).toBe(1);
    state = applyDart(state, createDart("triple", 1)).state;
    expect(state.playerStates[0].score).toBe(1 + 3);
    state = applyDart(state, createDart("miss", 0)).state;
    // auto-ended turn after 3 darts → Bob to throw, Alice score stays
    expect(state.playerStates[0].score).toBe(4);
    expect(state.currentPlayerIndex).toBe(1);
  });

  it("visit points ignore wrong segments in the Σ", () => {
    const darts = [
      createDart("single", 2),
      createDart("triple", 20),
      createDart("double", 2),
    ];
    expect(baseballVisitPoints(darts, 2)).toBe(2 + 0 + 4);
  });

  it("advances innings and ends after 9 with highest total winning", () => {
    let state = start();
    // Play all 9 innings: Alice hits T of target each visit; Bob misses all
    for (let inn = 1; inn <= BASEBALL_INNINGS; inn++) {
      expect(baseballInning(state)).toBe(inn);
      // Alice
      state = applyDart(state, createDart("triple", inn)).state;
      if (state.currentTurnDarts.length > 0) {
        state = applyDart(state, createDart("miss", 0)).state;
      }
      if (state.currentTurnDarts.length > 0) {
        state = applyDart(state, createDart("miss", 0)).state;
      }
      // Bob — three misses (may auto-finalize)
      if (state.status === "playing") {
        state = applyDart(state, createDart("miss", 0)).state;
      }
      if (state.status === "playing" && state.currentTurnDarts.length > 0) {
        state = applyDart(state, createDart("miss", 0)).state;
      }
      if (state.status === "playing" && state.currentTurnDarts.length > 0) {
        state = applyDart(state, createDart("miss", 0)).state;
      }
    }

    expect(state.status === "leg_won" || state.status === "match_won").toBe(true);
    // Alice: T1+T2+…+T9 = 3*(1+…+9) = 3*45 = 135
    expect(state.playerStates[0].score).toBe(135);
    expect(state.playerStates[1].score).toBe(0);
    expect(state.legWinnerId ?? state.winnerId).toBe("p1");
  });
});
