import { describe, expect, it } from "vitest";
import { applyDart, createDart, createGame, type GameState } from "@/engine";
import {
  applyCameraCorrect,
  applyCameraDart,
  applyCameraEndTurn,
  upsertServerMatch,
  removeServerMatch,
} from "@/lib/server-game-store";

const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

function x01Board(roomId: string) {
  return createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: false },
    },
    players: [alice, bob],
    matchFormat: { legsToWin: 1, setsToWin: 1 },
    roomId,
  });
}

function withDarts(state: GameState, ...darts: ReturnType<typeof createDart>[]) {
  return darts.reduce((s, d) => applyDart(s, d).state, state);
}

describe("camera correct bleed guard", () => {
  it("refuses non-empty correct onto the next thrower's empty visit", () => {
    // Full visit auto-ends -> Bob is current with empty open visit
    const state = withDarts(
      x01Board("Board 1"),
      createDart("single", 20),
      createDart("single", 5),
      createDart("single", 1)
    );
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.currentTurnDarts).toHaveLength(0);

    upsertServerMatch(state);
    try {
      const result = applyCameraCorrect({
        roomId: "Board 1",
        darts: [
          { kind: "single", number: 20 },
          { kind: "single", number: 5 },
          { kind: "single", number: 1 },
        ],
        reason: "residual_p1_visit",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/No open visit/i);
      }
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("still accepts mid-visit correct on the open thrower", () => {
    const state = withDarts(x01Board("Board 1"), createDart("triple", 20));
    upsertServerMatch(state);
    try {
      const result = applyCameraCorrect({
        roomId: "Board 1",
        darts: [{ kind: "triple", number: 19 }],
        reason: "fix",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.state.currentTurnDarts).toHaveLength(1);
        expect(result.state.currentTurnDarts[0].number).toBe(19);
        expect(result.state.currentPlayerIndex).toBe(0);
      }
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("turnEnded after 3rd camera dart advances seat", () => {
    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: false },
      },
      players: [alice, bob],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
      roomId: "Board Bleed",
    });
    upsertServerMatch(state);
    try {
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId: "Board Bleed",
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board Bleed",
        }).ok
      ).toBe(true);
      const third = applyCameraDart({
        kind: "single",
        number: 1,
        roomId: "Board Bleed",
      });
      expect(third.ok).toBe(true);
      if (third.ok) {
        expect(third.turnEnded).toBe(true);
        expect(third.state.currentPlayerIndex).toBe(1);
        expect(third.state.currentTurnDarts).toHaveLength(0);
      }
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("end-turn after only 2 darts advances seat so a later dart lands on P2", () => {
    // Documents No3 server behavior the Autodarts bridge must avoid:
    // never POST /end-turn before dart 3 of a full visit is mirrored.
    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: false },
      },
      players: [alice, bob],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
      roomId: "Board SeatJump",
    });
    upsertServerMatch(state);
    try {
      expect(
        applyCameraDart({
          kind: "triple",
          number: 20,
          roomId: "Board SeatJump",
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board SeatJump",
        }).ok
      ).toBe(true);

      const ended = applyCameraEndTurn({ roomId: "Board SeatJump" });
      expect(ended.ok).toBe(true);
      if (ended.ok) {
        expect(ended.state.currentPlayerIndex).toBe(1);
        expect(ended.state.currentTurnDarts).toHaveLength(0);
      }

      const lateThird = applyCameraDart({
        kind: "double",
        number: 16,
        roomId: "Board SeatJump",
      });
      expect(lateThird.ok).toBe(true);
      if (lateThird.ok) {
        // This is the P0 symptom if the bridge ends early — dart 3 on next seat
        expect(lateThird.state.currentPlayerIndex).toBe(1);
        expect(lateThird.state.currentTurnDarts).toHaveLength(1);
        expect(lateThird.state.currentTurnDarts[0]?.number).toBe(16);
      }
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("expectedPlayerIndex seat lock refuses dart/end-turn on the next seat", () => {
    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: false },
      },
      players: [alice, bob],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
      roomId: "Board SeatLock",
    });
    upsertServerMatch(state);
    try {
      expect(
        applyCameraDart({
          kind: "triple",
          number: 20,
          roomId: "Board SeatLock",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board SeatLock",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      // Premature end-turn advances to Bob
      expect(applyCameraEndTurn({ roomId: "Board SeatLock" }).ok).toBe(true);

      const lateThird = applyCameraDart({
        kind: "double",
        number: 16,
        roomId: "Board SeatLock",
        expectedPlayerIndex: 0, // still locked to Alice's visit
      });
      expect(lateThird.ok).toBe(false);
      if (!lateThird.ok) {
        expect(lateThird.error).toMatch(/Seat mismatch/i);
      }

      const badEnd = applyCameraEndTurn({
        roomId: "Board SeatLock",
        expectedPlayerIndex: 0,
      });
      expect(badEnd.ok).toBe(false);
      if (!badEnd.ok) {
        expect(badEnd.error).toMatch(/Seat mismatch/i);
      }
    } finally {
      removeServerMatch(state.id);
    }
  });
});
