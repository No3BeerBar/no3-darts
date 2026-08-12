/**
 * Board 1 freeze: 2-player 41 after round 3 (any double).
 *
 * Symptom: P2's darts stop applying and the visit never advances.
 * Camera path must keep scoring both seats through round 3+ with the
 * takeout hold cleared between visits (companion handshake / Ready).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import { fortyOneRoundNumber, fortyOneTarget } from "@/engine/modes/forty-one";
import {
  applyCameraCorrect,
  applyCameraDart,
  clearTakeoutHold,
  getCameraGateSnapshot,
  removeServerMatch,
  requestTakeoutReady,
  setCameraHealth,
  upsertServerMatch,
} from "@/lib/server-game-store";

const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

const ROOM = "Board1 FortyOne R3";

function fortyOneMatch(roomId: string) {
  return createGame({
    modeConfig: { mode: "forty_one", config: {} },
    players: [alice, bob],
    matchFormat: { legsToWin: 1, setsToWin: 1 },
    roomId,
  });
}

function clearRoom(roomId: string) {
  clearTakeoutHold(roomId);
  setCameraHealth({
    roomId,
    ok: true,
    level: "ok",
    message: "Ready for next visit",
    reason: "takeout_cleared",
    takeout: false,
    ts: Date.now(),
  });
}

type CamDart = { kind: "single" | "double" | "triple" | "miss"; number: number };

function throwVisit(
  roomId: string,
  seat: number,
  darts: CamDart[]
): { ok: true; state: ReturnType<typeof createGame> } {
  let last: ReturnType<typeof applyCameraDart> | undefined;
  for (let i = 0; i < darts.length; i++) {
    last = applyCameraDart({
      ...darts[i],
      roomId,
      expectedPlayerIndex: seat,
    });
    expect(last.ok, `seat ${seat} dart ${i + 1}: ${last.ok ? "" : last.error}`).toBe(
      true
    );
    if (!last.ok) throw new Error(last.error);
  }
  expect(last && last.ok && last.turnEnded).toBe(true);
  if (!last || !last.ok) throw new Error("visit did not apply");
  return last;
}

afterEach(() => {
  clearRoom(ROOM);
});

describe("camera 2-player 41 after round 3", () => {
  it("keeps scoring P2 and advancing through any-double into 18s", () => {
    const state = fortyOneMatch(ROOM);
    upsertServerMatch(state);
    clearRoom(ROOM);
    try {
      const miss: CamDart[] = [
        { kind: "miss", number: 0 },
        { kind: "miss", number: 0 },
        { kind: "miss", number: 0 },
      ];
      const doubles: CamDart[] = [
        { kind: "double", number: 20 },
        { kind: "double", number: 16 },
        { kind: "double", number: 8 },
      ];
      const eighteens: CamDart[] = [
        { kind: "triple", number: 18 },
        { kind: "miss", number: 0 },
        { kind: "miss", number: 0 },
      ];

      // Rounds 1–2: 20 then 19 (both miss)
      let live = state;
      for (let r = 0; r < 2; r++) {
        for (const seat of [0, 1]) {
          const res = throwVisit(ROOM, seat, miss);
          live = res.state;
          expect(live.currentTurnDarts).toHaveLength(0);
          requestTakeoutReady(ROOM);
          expect(getCameraGateSnapshot(ROOM).holdUntilTakeoutClear).toBe(false);
        }
      }

      expect(fortyOneTarget(live).type).toBe("any_double");
      expect(fortyOneRoundNumber(live)).toBe(3);
      const afterTwo = throwVisit(ROOM, 0, doubles); // Alice any-double
      expect(afterTwo.state.currentPlayerIndex).toBe(1);
      expect(fortyOneRoundNumber(afterTwo.state)).toBe(3);
      requestTakeoutReady(ROOM);

      // The freeze: P2 on any-double — darts must apply and the visit must end
      const bobVisit = throwVisit(ROOM, 1, miss);
      expect(bobVisit.state.currentPlayerIndex).toBe(0);
      expect(bobVisit.state.currentTurnDarts).toHaveLength(0);
      expect(fortyOneTarget(bobVisit.state)).toEqual({ type: "number", n: 18 });
      expect(fortyOneRoundNumber(bobVisit.state)).toBe(4);
      requestTakeoutReady(ROOM);

      const r4 = throwVisit(ROOM, 0, eighteens);
      expect(r4.state.currentPlayerIndex).toBe(1);
      expect(r4.state.status).toBe("playing");
      requestTakeoutReady(ROOM);
      const r4b = throwVisit(ROOM, 1, miss);
      expect(r4b.state.currentPlayerIndex).toBe(0);
      expect(fortyOneTarget(r4b.state)).toEqual({ type: "number", n: 17 });
    } finally {
      removeServerMatch(state.id);
      clearRoom(ROOM);
    }
  });

  it("3-dart camera correct auto-ends so the visit cannot sit on Turn full", () => {
    const state = fortyOneMatch(ROOM);
    upsertServerMatch(state);
    clearRoom(ROOM);
    try {
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId: ROOM,
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      const corrected = applyCameraCorrect({
        roomId: ROOM,
        expectedPlayerIndex: 0,
        darts: [
          { kind: "triple", number: 20 },
          { kind: "miss", number: 0 },
          { kind: "miss", number: 0 },
        ],
        reason: "autodarts_state_diff",
      });
      expect(corrected.ok).toBe(true);
      if (!corrected.ok) throw new Error(corrected.error);
      expect(corrected.turnEnded).toBe(true);
      expect(corrected.state.currentPlayerIndex).toBe(1);
      expect(corrected.state.currentTurnDarts).toHaveLength(0);
      expect(corrected.state.playerStates[0].extra?.lastVisitPoints).toBe(60);
    } finally {
      removeServerMatch(state.id);
      clearRoom(ROOM);
    }
  });
});
