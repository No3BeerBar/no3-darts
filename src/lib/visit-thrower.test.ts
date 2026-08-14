import { applyDart, createDart, createGame, type Turn } from "@/engine";
import { describe, expect, it } from "vitest";
import { visitThrowerLabel, visitThrowerName } from "./visit-thrower";

describe("visitThrowerName", () => {
  it("labels a completed visit with the player who threw", () => {
    let state = createGame({
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
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    const last = state.turns.at(-1);
    expect(last).toBeTruthy();
    expect(visitThrowerName(state, last!)).toBe("Alice");
    expect(visitThrowerLabel(state, last!)).toBe("Alice");
  });

  it("falls back to a seat label when the name is missing", () => {
    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: true },
      },
      players: [
        { id: "a", name: "   ", isGuest: true },
        { id: "b", name: "Bob", isGuest: true },
      ],
    });
    const turn = {
      playerId: "a",
      darts: [],
      startScore: 501,
      endScore: 501,
      bust: false,
      checkout: false,
      timestamp: 1,
    } satisfies Turn;
    expect(visitThrowerName(state, turn)).toBe("Seat 1");
  });
});
