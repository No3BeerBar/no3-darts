import { describe, expect, it } from "vitest";
import {
  applyDart,
  correctCurrentTurn,
  createDart,
  createGame,
  editLastTurn,
  undo,
} from "@/engine";

const alice = { id: "p1", name: "Alice", isGuest: false };
const bob = { id: "p2", name: "Bob", isGuest: true };

function x01Game() {
  return createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: false },
    },
    players: [alice, bob],
    matchFormat: { legsToWin: 1, setsToWin: 1 },
  });
}

describe("edited visit integrity flags", () => {
  it("clean camera/manual visit is not marked edited", () => {
    let state = x01Game();
    state = applyDart(state, createDart("single", 20, { source: "camera" })).state;
    state = applyDart(state, createDart("single", 5, { source: "camera" })).state;
    state = applyDart(state, createDart("single", 1, { source: "manual" })).state;
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].edited).toBeFalsy();
    expect(state.turns[0].darts.every((d) => !d.edited)).toBe(true);
    expect(state.currentVisitEdited).toBeFalsy();
  });

  it("mid-visit undo marks the re-finalized visit as edited", () => {
    let state = x01Game();
    state = applyDart(state, createDart("triple", 20, { source: "camera" })).state;
    state = applyDart(state, createDart("triple", 20, { source: "camera" })).state;
    state = undo(state).state;
    expect(state.currentVisitEdited).toBe(true);
    expect(state.currentTurnDarts.every((d) => d.edited)).toBe(true);

    state = applyDart(state, createDart("single", 1, { source: "manual" })).state;
    state = applyDart(state, createDart("single", 1, { source: "manual" })).state;
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].edited).toBe(true);
    expect(state.turns[0].darts.every((d) => d.edited)).toBe(true);
    expect(state.currentVisitEdited).toBeFalsy();
  });

  it("correctCurrentTurn marks the visit edited", () => {
    let state = x01Game();
    state = applyDart(state, createDart("single", 20)).state;
    state = applyDart(state, createDart("single", 5)).state;
    const corrected = [
      createDart("triple", 20, { source: "camera" }),
      createDart("single", 1, { source: "camera" }),
    ];
    state = correctCurrentTurn(state, corrected, { autoEnd: false }).state;
    expect(state.currentVisitEdited).toBe(true);
    expect(state.currentTurnDarts.every((d) => d.edited)).toBe(true);

    state = applyDart(state, createDart("single", 1)).state;
    expect(state.turns[0].edited).toBe(true);
  });

  it("editLastTurn voids credit on the re-finalized visit", () => {
    let state = x01Game();
    state = applyDart(state, createDart("single", 20)).state;
    state = applyDart(state, createDart("single", 5)).state;
    state = applyDart(state, createDart("single", 1)).state;
    expect(state.turns[0].edited).toBeFalsy();

    state = editLastTurn(state).state;
    expect(state.turns).toHaveLength(0);
    expect(state.currentVisitEdited).toBe(true);
    expect(state.currentTurnDarts.every((d) => d.edited)).toBe(true);

    // Re-finalize (3rd dart already present — end via applying nothing? visit has 3)
    // editLast restores 3 darts without auto-end; push one more won't work (full).
    // Use correctCurrentTurn autoEnd to finalize.
    state = correctCurrentTurn(state, state.currentTurnDarts, { autoEnd: true }).state;
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].edited).toBe(true);
  });

  it("preserves edited through a second rewrite", () => {
    let state = x01Game();
    state = applyDart(state, createDart("single", 20)).state;
    state = undo(state).state;
    state = applyDart(state, createDart("triple", 19)).state;
    state = undo(state).state;
    state = applyDart(state, createDart("single", 5)).state;
    state = applyDart(state, createDart("single", 1)).state;
    state = applyDart(state, createDart("single", 1)).state;
    expect(state.turns[0].edited).toBe(true);
  });
});
