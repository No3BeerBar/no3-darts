import { describe, expect, it } from "vitest";
import { applyDart, createDart, createGame, type GameState } from "@/engine";
import {
  applyCameraCorrect,
  applyCameraDart,
  applyCameraEndTurn,
  applyCameraUndo,
  clearTakeoutHold,
  getCameraGateSnapshot,
  requestTakeoutReady,
  setCameraHealth,
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
    clearTakeoutHold("Board 1");
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
        expect(result.error).toMatch(/No open visit|Takeout hold/i);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board 1");
    }
  });

  it("still accepts mid-visit correct on the open thrower", () => {
    const state = withDarts(x01Board("Board 1"), createDart("triple", 20));
    upsertServerMatch(state);
    clearTakeoutHold("Board 1");
    try {
      const result = applyCameraCorrect({
        roomId: "Board 1",
        darts: [{ kind: "triple", number: 19 }],
        reason: "fix",
        expectedPlayerIndex: 0,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.state.currentTurnDarts).toHaveLength(1);
        expect(result.state.currentTurnDarts[0].number).toBe(19);
        expect(result.state.currentPlayerIndex).toBe(0);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board 1");
    }
  });

  it("turnEnded after 3rd camera dart advances seat and holds next visit", () => {
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
    clearTakeoutHold("Board Bleed");
    try {
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId: "Board Bleed",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board Bleed",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      const third = applyCameraDart({
        kind: "single",
        number: 1,
        roomId: "Board Bleed",
        expectedPlayerIndex: 0,
      });
      expect(third.ok).toBe(true);
      if (third.ok) {
        expect(third.turnEnded).toBe(true);
        expect(third.state.currentPlayerIndex).toBe(1);
        expect(third.state.currentTurnDarts).toHaveLength(0);
      }
      expect(getCameraGateSnapshot("Board Bleed").holdUntilTakeoutClear).toBe(
        true
      );
      // Next seat cannot score until takeout cleared
      const early = applyCameraDart({
        kind: "triple",
        number: 20,
        roomId: "Board Bleed",
        expectedPlayerIndex: 1,
      });
      expect(early.ok).toBe(false);
      if (!early.ok) {
        expect(early.error).toMatch(/Takeout hold/i);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board Bleed");
    }
  });

  it("takeout hold blocks late dart 3 from starting next seat after premature end-turn", () => {
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
    clearTakeoutHold("Board SeatJump");
    try {
      expect(
        applyCameraDart({
          kind: "triple",
          number: 20,
          roomId: "Board SeatJump",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board SeatJump",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      const ended = applyCameraEndTurn({
        roomId: "Board SeatJump",
        expectedPlayerIndex: 0,
      });
      expect(ended.ok).toBe(true);
      if (ended.ok) {
        expect(ended.state.currentPlayerIndex).toBe(1);
        expect(ended.state.currentTurnDarts).toHaveLength(0);
      }
      expect(getCameraGateSnapshot("Board SeatJump").holdUntilTakeoutClear).toBe(
        true
      );

      // P0: late dart 3 must NOT become P2 dart 1
      const lateThird = applyCameraDart({
        kind: "double",
        number: 16,
        roomId: "Board SeatJump",
        expectedPlayerIndex: 1,
      });
      expect(lateThird.ok).toBe(false);
      if (!lateThird.ok) {
        expect(lateThird.error).toMatch(/Takeout hold/i);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board SeatJump");
    }
  });

  it("open visit requires expectedPlayerIndex=N and rejects other seats", () => {
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
    clearTakeoutHold("Board SeatLock");
    try {
      expect(
        applyCameraDart({
          kind: "triple",
          number: 20,
          roomId: "Board SeatLock",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      // Hard invariant: while visit open, expectedPlayerIndex required
      const missing = applyCameraDart({
        kind: "single",
        number: 5,
        roomId: "Board SeatLock",
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) {
        expect(missing.error).toMatch(/expectedPlayerIndex required/i);
      }

      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board SeatLock",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      // Premature end-turn advances to Bob + takeout hold
      expect(
        applyCameraEndTurn({
          roomId: "Board SeatLock",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      const lateThird = applyCameraDart({
        kind: "double",
        number: 16,
        roomId: "Board SeatLock",
        expectedPlayerIndex: 0, // still locked to Alice's visit
      });
      expect(lateThird.ok).toBe(false);
      if (!lateThird.ok) {
        expect(lateThird.error).toMatch(/Seat mismatch|Takeout hold/i);
      }

      const badEnd = applyCameraEndTurn({
        roomId: "Board SeatLock",
        expectedPlayerIndex: 0,
      });
      // Empty visit after end-turn returns READY (hold kept)
      expect(badEnd.ok).toBe(true);
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board SeatLock");
    }
  });

  it("hold + missing expectedPlayerIndex rejects dart/end-turn/correct", () => {
    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: false },
      },
      players: [alice, bob],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
      roomId: "Board LockReq",
    });
    upsertServerMatch(state);
    clearTakeoutHold("Board LockReq");
    try {
      applyCameraDart({
        kind: "single",
        number: 20,
        roomId: "Board LockReq",
        expectedPlayerIndex: 0,
      });
      applyCameraDart({
        kind: "single",
        number: 5,
        roomId: "Board LockReq",
        expectedPlayerIndex: 0,
      });
      applyCameraDart({
        kind: "single",
        number: 1,
        roomId: "Board LockReq",
        expectedPlayerIndex: 0,
      });
      expect(getCameraGateSnapshot("Board LockReq").holdUntilTakeoutClear).toBe(
        true
      );

      const dart = applyCameraDart({
        kind: "triple",
        number: 19,
        roomId: "Board LockReq",
      });
      expect(dart.ok).toBe(false);
      if (!dart.ok) {
        expect(dart.error).toMatch(/expectedPlayerIndex required/i);
      }

      const end = applyCameraEndTurn({ roomId: "Board LockReq" });
      expect(end.ok).toBe(false);
      if (!end.ok) {
        expect(end.error).toMatch(/expectedPlayerIndex required/i);
      }

      const correct = applyCameraCorrect({
        roomId: "Board LockReq",
        darts: [{ kind: "single", number: 1 }],
      });
      expect(correct.ok).toBe(false);
      if (!correct.ok) {
        expect(correct.error).toMatch(
          /expectedPlayerIndex required|No open visit/i
        );
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board LockReq");
    }
  });

  it("Ready / takeout_cleared releases hold so next seat can score", () => {
    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: false },
      },
      players: [alice, bob],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
      roomId: "Board Ready",
    });
    upsertServerMatch(state);
    clearTakeoutHold("Board Ready");
    try {
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId: "Board Ready",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board Ready",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 1,
          roomId: "Board Ready",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(getCameraGateSnapshot("Board Ready").holdUntilTakeoutClear).toBe(
        true
      );

      requestTakeoutReady("Board Ready");
      expect(getCameraGateSnapshot("Board Ready").holdUntilTakeoutClear).toBe(
        false
      );

      const next = applyCameraDart({
        kind: "triple",
        number: 19,
        roomId: "Board Ready",
        expectedPlayerIndex: 1,
      });
      expect(next.ok).toBe(true);
      if (next.ok) {
        expect(next.state.currentPlayerIndex).toBe(1);
        expect(next.state.currentTurnDarts).toHaveLength(1);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board Ready");
    }
  });

  it("health takeout_cleared also releases next-seat hold", () => {
    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: false },
      },
      players: [alice, bob],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
      roomId: "Board HealthClear",
    });
    upsertServerMatch(state);
    clearTakeoutHold("Board HealthClear");
    try {
      applyCameraDart({
        kind: "single",
        number: 20,
        roomId: "Board HealthClear",
        expectedPlayerIndex: 0,
      });
      applyCameraDart({
        kind: "single",
        number: 5,
        roomId: "Board HealthClear",
        expectedPlayerIndex: 0,
      });
      applyCameraDart({
        kind: "single",
        number: 1,
        roomId: "Board HealthClear",
        expectedPlayerIndex: 0,
      });
      expect(
        getCameraGateSnapshot("Board HealthClear").holdUntilTakeoutClear
      ).toBe(true);

      setCameraHealth({
        roomId: "Board HealthClear",
        ok: true,
        level: "ok",
        message: "Ready for next visit",
        reason: "takeout_cleared",
        takeout: false,
        ts: Date.now(),
      });
      expect(
        getCameraGateSnapshot("Board HealthClear").holdUntilTakeoutClear
      ).toBe(false);
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board HealthClear");
    }
  });

  it("undo after 3-dart visit clears takeout hold so camera can score again", () => {
    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: false },
      },
      players: [alice, bob],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
      roomId: "Board UndoHold",
    });
    upsertServerMatch(state);
    clearTakeoutHold("Board UndoHold");
    try {
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId: "Board UndoHold",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board UndoHold",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 1,
          roomId: "Board UndoHold",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(getCameraGateSnapshot("Board UndoHold").holdUntilTakeoutClear).toBe(
        true
      );

      expect(applyCameraUndo({ roomId: "Board UndoHold" }).ok).toBe(true);
      expect(applyCameraUndo({ roomId: "Board UndoHold" }).ok).toBe(true);
      expect(applyCameraUndo({ roomId: "Board UndoHold" }).ok).toBe(true);
      expect(getCameraGateSnapshot("Board UndoHold").holdUntilTakeoutClear).toBe(
        false
      );

      const again = applyCameraDart({
        kind: "triple",
        number: 20,
        roomId: "Board UndoHold",
        expectedPlayerIndex: 0,
      });
      expect(again.ok).toBe(true);
      if (again.ok) {
        expect(again.state.currentPlayerIndex).toBe(0);
        expect(again.state.currentTurnDarts).toHaveLength(1);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board UndoHold");
    }
  });
});
