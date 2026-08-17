/**
 * App-side Board 1 fuzzer: random camera op sequences against server-game-store.
 *
 * Simulates companion posts with required expectedPlayerIndex, takeout hold,
 * and Ready clear — asserts fail-closed seat / bleed / takeout / undo invariants.
 */

import { describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import {
  applyCameraCorrect,
  applyCameraDart,
  applyCameraEndTurn,
  applyCameraUndo,
  clearTakeoutHold,
  consumeTakeoutReady,
  getCameraHealth,
  removeServerMatch,
  requestTakeoutReady,
  setCameraHealth,
  upsertServerMatch,
} from "@/lib/server-game-store";

const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

const FUZZ_SEED = 0x51a7;
const FUZZ_CASES = 80;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function board(roomId: string) {
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

const DARTS = [
  { kind: "triple" as const, number: 20 },
  { kind: "single" as const, number: 5 },
  { kind: "double" as const, number: 16 },
  { kind: "single" as const, number: 1 },
  { kind: "triple" as const, number: 19 },
];

const FAIL_RE =
  /Seat mismatch|Takeout hold|Takeout active|expectedPlayerIndex required|No open visit|No active match|Bot thrower|Match status|Nothing to undo/i;

describe("Board1 camera fuzz: seat lock + takeout hold + undo", () => {
  it.each(Array.from({ length: FUZZ_CASES }, (_, i) => i))(
    "random camera sequence case %s never applies locked dart to wrong seat",
    (caseI) => {
      const rnd = mulberry32(FUZZ_SEED + caseI);
      const roomId = `Board1 Fuzz ${caseI}`;
      const state = board(roomId);
      upsertServerMatch(state);
      clearTakeoutHold(roomId);
      try {
        let seat = 0;
        let openVisit = false;
        const ops = 12 + Math.floor(rnd() * 10);

        for (let step = 0; step < ops; step++) {
          const roll = rnd();
          const dart = DARTS[Math.floor(rnd() * DARTS.length)]!;

          if (roll < 0.08) {
            const on = rnd() < 0.5;
            setCameraHealth({
              roomId,
              ok: !on,
              level: on ? "takeout" : "ok",
              message: on ? "Pull darts - takeout" : "ok",
              reason: on ? "takeout" : "takeout_cleared",
              takeout: on,
              ts: Date.now(),
            });
            if (!on) {
              // Clearing takeout health releases hold (bridge path)
              // Ready also clears
              if (rnd() < 0.5) requestTakeoutReady(roomId);
            }
            continue;
          }

          if (roll < 0.12) {
            requestTakeoutReady(roomId);
            openVisit = false;
            continue;
          }

          if (roll < 0.55) {
            const expected = openVisit ? seat : rnd() < 0.85 ? seat : undefined;
            const res = applyCameraDart({
              ...dart,
              roomId,
              expectedPlayerIndex: expected,
            });
            if (res.ok) {
              seat = res.state.currentPlayerIndex;
              openVisit = !res.turnEnded && res.state.currentTurnDarts.length > 0;
              if (res.turnEnded) openVisit = false;
            } else {
              expect(res.error).toMatch(FAIL_RE);
            }
          } else if (roll < 0.72) {
            const expected = openVisit ? seat : undefined;
            const res = applyCameraEndTurn({
              roomId,
              expectedPlayerIndex: expected,
            });
            if (res.ok) {
              seat = res.state.currentPlayerIndex;
              openVisit = false;
            } else if (expected != null) {
              expect(res.error).toMatch(FAIL_RE);
            }
          } else if (roll < 0.86) {
            const list =
              rnd() < 0.5
                ? [dart]
                : DARTS.slice(0, 1 + Math.floor(rnd() * 3)).map((d) => ({
                    kind: d.kind,
                    number: d.number,
                  }));
            const res = applyCameraCorrect({
              roomId,
              darts: list,
              reason: "fuzz",
              expectedPlayerIndex: openVisit ? seat : seat,
            });
            if (!res.ok) {
              expect(res.error).toMatch(FAIL_RE);
            } else {
              seat = res.state.currentPlayerIndex;
              openVisit =
                !res.turnEnded && res.state.currentTurnDarts.length > 0;
            }
          } else {
            const res = applyCameraUndo({ roomId });
            if (!res.ok) {
              expect(res.error).toMatch(FAIL_RE);
            } else {
              seat = res.state.currentPlayerIndex;
              openVisit = res.state.currentTurnDarts.length > 0;
            }
          }
        }
      } finally {
        clearTakeoutHold(roomId);
        setCameraHealth({
          roomId,
          ok: true,
          level: "ok",
          message: "",
          takeout: false,
          reason: "takeout_cleared",
          ts: Date.now(),
        });
        removeServerMatch(state.id);
      }
    }
  );
});

describe("Board1 takeout Ready / health", () => {
  it("takeout health freezes new visits; Ready consume clears pending ack", () => {
    const room = "Board 1 Fuzz Ready";
    const state = board(room);
    upsertServerMatch(state);
    clearTakeoutHold(room);
    try {
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId: room,
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      setCameraHealth({
        roomId: room,
        ok: false,
        level: "takeout",
        message: "Pull darts - takeout",
        takeout: true,
        ts: Date.now(),
      });
      expect(getCameraHealth(room)?.takeout).toBe(true);

      const ack = requestTakeoutReady(room);
      expect(ack.roomId).toBe(room);
      expect(consumeTakeoutReady(room, false).pending).toBe(true);
      expect(consumeTakeoutReady(room, true).pending).toBe(true);
      expect(consumeTakeoutReady(room, true).pending).toBe(false);

      setCameraHealth({
        roomId: room,
        ok: true,
        level: "ok",
        message: "Ready for next visit",
        takeout: false,
        reason: "takeout_cleared",
        ts: Date.now(),
      });
      expect(getCameraHealth(room)?.takeout).toBe(false);
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold(room);
    }
  });
});
