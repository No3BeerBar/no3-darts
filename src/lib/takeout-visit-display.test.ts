import { applyDart, createDart, createGame } from "@/engine";
import { describe, expect, it } from "vitest";
import { takeoutVisitDisplay } from "./takeout-visit-display";

function x01() {
  return createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    players: [
      { id: "a", name: "Alice", isGuest: true },
      { id: "b", name: "Bob", isGuest: true },
    ],
    roomId: "Board 1",
  });
}

describe("takeoutVisitDisplay", () => {
  it("without takeout shows the live seat and open visit", () => {
    let state = x01();
    state = applyDart(state, createDart("triple", 20)).state;
    const view = takeoutVisitDisplay(state, false);
    expect(view.playerIndex).toBe(0);
    expect(view.darts).toHaveLength(1);
    expect(view.holdingLastVisit).toBe(false);
  });

  it("during takeout after a finished visit keeps last player + 3 darts", () => {
    let state = x01();
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(state.turns.at(-1)?.darts).toHaveLength(3);

    const view = takeoutVisitDisplay(state, true);
    expect(view.holdingLastVisit).toBe(true);
    expect(view.playerIndex).toBe(0);
    expect(view.darts).toHaveLength(3);
    expect(view.darts.map((d) => d.value)).toEqual([60, 60, 60]);
  });

  it("during takeout mid-visit keeps the open seat (dart-3 still landing)", () => {
    let state = x01();
    state = applyDart(state, createDart("single", 20)).state;
    state = applyDart(state, createDart("single", 5)).state;
    const view = takeoutVisitDisplay(state, true);
    expect(view.holdingLastVisit).toBe(false);
    expect(view.playerIndex).toBe(0);
    expect(view.darts).toHaveLength(2);
  });

  it("clears the hold when takeout is off even if the last visit exists", () => {
    let state = x01();
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    const view = takeoutVisitDisplay(state, false);
    expect(view.holdingLastVisit).toBe(false);
    expect(view.playerIndex).toBe(1);
    expect(view.darts).toHaveLength(0);
  });
});
