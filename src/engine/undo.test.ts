import { describe, expect, it } from "vitest";
import {
  applyDart,
  canUndo,
  createDart,
  createGame,
  getRemaining,
  undo,
} from "@/engine";

const alice = { id: "p1", name: "Alice", isGuest: true };
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

function cricketGame() {
  return createGame({
    modeConfig: { mode: "cricket", config: { variant: "standard" } },
    players: [alice, bob],
    matchFormat: { legsToWin: 1, setsToWin: 1 },
  });
}

describe("multi-step undo", () => {
  it("walks backward dart-by-dart within a visit", () => {
    let state = x01Game();
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 19)).state;
    expect(state.currentTurnDarts).toHaveLength(2);
    expect(canUndo(state)).toBe(true);

    state = undo(state).state;
    expect(state.currentTurnDarts).toHaveLength(1);
    expect(state.currentTurnDarts[0].number).toBe(20);

    state = undo(state).state;
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(getRemaining(state, "p1")).toBe(501);
  });

  it("after a full visit, undo reopens and drops the last dart", () => {
    let state = x01Game();
    state = applyDart(state, createDart("single", 20)).state;
    state = applyDart(state, createDart("single", 5)).state;
    state = applyDart(state, createDart("single", 1)).state; // auto end
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(state.currentPlayerIndex).toBe(1); // Bob
    expect(getRemaining(state, "p1")).toBe(501 - 26);

    state = undo(state).state;
    expect(state.currentPlayerIndex).toBe(0); // Alice again
    expect(state.currentTurnDarts).toHaveLength(2);
    expect(state.currentTurnDarts.map((d) => d.number)).toEqual([20, 5]);
    // Score restored to visit start; remaining subtracts open visit (20+5)
    expect(state.playerStates[0].score).toBe(501);
    expect(getRemaining(state, "p1")).toBe(476);

    state = undo(state).state;
    expect(state.currentTurnDarts).toHaveLength(1);
    expect(getRemaining(state, "p1")).toBe(481);
    state = undo(state).state;
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(getRemaining(state, "p1")).toBe(501);
    expect(canUndo(state)).toBe(false);
  });

  it("repeated undo walks across the previous player visit", () => {
    let state = x01Game();
    // Alice 20+5+1
    state = applyDart(state, createDart("single", 20)).state;
    state = applyDart(state, createDart("single", 5)).state;
    state = applyDart(state, createDart("single", 1)).state;
    // Bob one dart
    state = applyDart(state, createDart("triple", 20)).state;
    expect(state.currentTurnDarts).toHaveLength(1);

    state = undo(state).state; // clear Bob's dart
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(state.currentPlayerIndex).toBe(1);

    state = undo(state).state; // reopen Alice with 2 darts
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.currentTurnDarts).toHaveLength(2);
  });

  it("rebuilds cricket marks from baseline (not a bare pop)", () => {
    let state = cricketGame();
    state = applyDart(state, createDart("triple", 20)).state;
    const marksAfter = state.playerStates[0].marks?.[20] ?? 0;
    expect(marksAfter).toBeGreaterThan(0);

    state = undo(state).state;
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(state.playerStates[0].marks?.[20] ?? 0).toBe(0);
  });

  it("full cricket visit undo does not double marks", () => {
    let state = cricketGame();
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("single", 19)).state;
    state = applyDart(state, createDart("single", 18)).state; // auto end
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.playerStates[0].marks?.[20]).toBe(3);
    expect(state.playerStates[0].marks?.[19]).toBe(1);
    expect(state.playerStates[0].marks?.[18]).toBe(1);
    expect(state.turns.at(-1)?.baselineStates).toBeTruthy();

    state = undo(state).state; // reopen with 2 darts (drop last)
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.currentTurnDarts).toHaveLength(2);
    expect(state.playerStates[0].marks?.[20]).toBe(3);
    expect(state.playerStates[0].marks?.[19]).toBe(1);
    expect(state.playerStates[0].marks?.[18] ?? 0).toBe(0);
  });

  it("returns Nothing to undo when idle", () => {
    const state = x01Game();
    const result = undo(state);
    expect(result.callout).toBe("Nothing to undo");
    expect(canUndo(state)).toBe(false);
  });

  it("undo after a first-dart X01 bust restores the busting thrower and leave", () => {
    let state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 18, doubleIn: false, doubleOut: true },
      },
      players: [alice, bob],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
    expect(state.currentPlayerIndex).toBe(0);
    expect(getRemaining(state, "p1")).toBe(18);

    const busted = applyDart(state, createDart("triple", 20));
    expect(busted.callout).toBe("BUST");
    state = busted.state;
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(getRemaining(state, "p1")).toBe(18);
    expect(state.turns.at(-1)?.bust).toBe(true);

    const undone = undo(state);
    expect(undone.callout).toBe("UNDO");
    state = undone.state;
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(getRemaining(state, "p1")).toBe(18);
    expect(state.turns.some((t) => t.bust)).toBe(false);
  });

  it("undo after a mid-visit X01 bust drops the bust dart and keeps the thrower", () => {
    let state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 40, doubleIn: false, doubleOut: true },
      },
      players: [alice, bob],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
    state = applyDart(state, createDart("single", 20)).state;
    expect(state.currentTurnDarts).toHaveLength(1);
    expect(getRemaining(state, "p1")).toBe(20);

    const busted = applyDart(state, createDart("triple", 20));
    expect(busted.callout).toBe("BUST");
    state = busted.state;
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(getRemaining(state, "p1")).toBe(40);

    state = undo(state).state;
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.currentTurnDarts).toHaveLength(1);
    expect(state.currentTurnDarts[0].number).toBe(20);
    expect(state.currentTurnDarts[0].kind).toBe("single");
    expect(getRemaining(state, "p1")).toBe(20);
    expect(state.turns.some((t) => t.bust)).toBe(false);
  });
});
