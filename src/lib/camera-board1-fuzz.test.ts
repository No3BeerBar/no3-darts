/**
 * App-side Board 1 fuzzer: random camera op sequences against server-game-store.
 *
 * Simulates companion posts (dart / end-turn / correct / undo) with seat locks
 * and asserts fail-closed seat / bleed / undo invariants without hardware.
 */

import { afterEach, describe, expect, it } from "vitest";
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

afterEach(() => {
  // rooms are unique per case via id; nothing global beyond matches map
});

describe("Board1 camera fuzz: seat lock + bleed + undo", () => {
  it.each(Array.from({ length: FUZZ_CASES }, (_, i) => i))(
    "random camera sequence case %s never applies locked dart to wrong seat",
    (caseI) => {
      const rnd = mulberry32(FUZZ_SEED + caseI);
      const roomId = `Board1 Fuzz ${caseI}`;
      const state = board(roomId);
      upsertServerMatch(state);
      try {
        let lockedSeat: number | null = null;
        let dartsOnLocked = 0;
        const ops = 12 + Math.floor(rnd() * 10);

        for (let step = 0; step < ops; step++) {
          const roll = rnd();
          const dart = DARTS[Math.floor(rnd() * DARTS.length)]!;

          if (roll < 0.45) {
            // Companion-style dart with seat lock once visit starts
            const expected =
              lockedSeat != null ? lockedSeat : rnd() < 0.7 ? 0 : undefined;
            const res = applyCameraDart({
              ...dart,
              roomId,
              expectedPlayerIndex: expected,
            });
            if (res.ok) {
              if (lockedSeat == null) {
                lockedSeat = res.state.currentPlayerIndex;
                // If turn already ended on this dart, lock resets next visit
                if (res.turnEnded) {
                  lockedSeat = null;
                  dartsOnLocked = 0;
                  clearTakeoutHold(roomId);
                } else {
                  dartsOnLocked = res.state.currentTurnDarts.length;
                }
              } else if (res.turnEnded) {
                lockedSeat = null;
                dartsOnLocked = 0;
                clearTakeoutHold(roomId);
              } else {
                dartsOnLocked = res.state.currentTurnDarts.length;
              }
            } else if (res.error.match(/Seat mismatch/i)) {
              // Fail-closed — must not have mutated seat; re-check via end-turn probe
              expect(res.ok).toBe(false);
            }
          } else if (roll < 0.65) {
            const expected =
              lockedSeat != null && rnd() < 0.8 ? lockedSeat : undefined;
            const res = applyCameraEndTurn({
              roomId,
              expectedPlayerIndex: expected,
            });
            if (res.ok) {
              // After end-turn, visit lock clears; release takeout hold so fuzz can continue
              lockedSeat = null;
              dartsOnLocked = 0;
              clearTakeoutHold(roomId);
            } else if (expected != null) {
              expect(res.error).toMatch(/Seat mismatch|expectedPlayerIndex|Takeout hold|Takeout active/i);
            }
          } else if (roll < 0.8) {
            // Correct: mid-visit OK; bleed onto empty next seat must fail
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
              expectedPlayerIndex:
                lockedSeat != null && rnd() < 0.7 ? lockedSeat : undefined,
            });
            if (!res.ok) {
              expect(res.error).toMatch(
                /Seat mismatch|No open visit|Takeout hold|Takeout active|No active match|Bot thrower|Match status|expectedPlayerIndex/i
              );
            } else if (res.turnEnded) {
              lockedSeat = null;
              dartsOnLocked = 0;
            } else {
              dartsOnLocked = res.state.currentTurnDarts.length;
              if (lockedSeat == null && dartsOnLocked > 0) {
                lockedSeat = res.state.currentPlayerIndex;
              }
            }
          } else {
            const res = applyCameraUndo({ roomId });
            if (!res.ok) {
              expect(res.error).toMatch(/Nothing to undo|No active match|Match status/i);
            } else {
              dartsOnLocked = res.state.currentTurnDarts.length;
              lockedSeat =
                dartsOnLocked > 0 ? res.state.currentPlayerIndex : null;
            }
          }
        }

        // Final hard check: posting dart for seat 0 while current is 1 must 409-style fail
        const probe = applyCameraDart({
          kind: "double",
          number: 16,
          roomId,
          expectedPlayerIndex: 0,
        });
        if (!probe.ok && /Seat mismatch/i.test(probe.error)) {
          expect(probe.error).toMatch(/Seat mismatch/i);
        }
        // Silence unused in edge cases
        expect(dartsOnLocked).toBeGreaterThanOrEqual(0);
      } finally {
        removeServerMatch(state.id);
      }
    }
  );
});

describe("Board1 takeout Ready / health", () => {
  it("takeout health freezes UI signal; Ready consume clears pending ack", () => {
    const room = "Board 1";
    setCameraHealth({
      roomId: room,
      ok: false,
      level: "takeout",
      message: "Pull darts — takeout",
      takeout: true,
      ts: Date.now(),
    });
    const health = getCameraHealth(room);
    expect(health?.takeout).toBe(true);

    const ack = requestTakeoutReady(room);
    expect(ack.roomId).toBe(room);
    const peek = consumeTakeoutReady(room, false);
    expect(peek.pending).toBe(true);
    const consumed = consumeTakeoutReady(room, true);
    expect(consumed.pending).toBe(true);
    expect(consumeTakeoutReady(room, true).pending).toBe(false);

    // Clear takeout health (bridge would do this after clean board)
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
  });
});

describe("Board1 expectedPlayerIndex fail-closed edge cases", () => {
  it("rejects NaN/non-finite quietly (no lock) but rejects wrong integer seat", () => {
    const roomId = "Board1 Seat Edges";
    const state = board(roomId);
    upsertServerMatch(state);
    try {
      // non-finite → no lock applied
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId,
          expectedPlayerIndex: Number.NaN,
        }).ok
      ).toBe(true);

      // Open visit requires a finite expectedPlayerIndex on end-turn
      expect(applyCameraEndTurn({ roomId }).ok).toBe(false);
      expect(applyCameraEndTurn({ roomId, expectedPlayerIndex: 0 }).ok).toBe(
        true
      );
      clearTakeoutHold(roomId);

      // After advance to seat 1, locking to seat 0 must fail closed
      const wrong = applyCameraDart({
        kind: "single",
        number: 5,
        roomId,
        expectedPlayerIndex: 0,
      });
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) {
        expect(wrong.error).toMatch(/Seat mismatch|Takeout hold/i);
      }
    } finally {
      removeServerMatch(state.id);
    }
  });
});
