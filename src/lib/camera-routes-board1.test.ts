/**
 * Board 1 camera route invariants (HTTP status mapping).
 *
 * Exercises /api/camera/{dart,correct,end-turn,undo} POST handlers:
 *   - 409 seat lock (expectedPlayerIndex mismatch)
 *   - takeout hold / bleed correct reject
 *   - multi-step undo + 409 when nothing to undo
 */

import { afterEach, describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import {
  clearTakeoutHold,
  removeServerMatch,
  upsertServerMatch,
} from "@/lib/server-game-store";
import { POST as postDart } from "@/app/api/camera/dart/route";
import { POST as postCorrect } from "@/app/api/camera/correct/route";
import { POST as postEndTurn } from "@/app/api/camera/end-turn/route";
import { POST as postUndo } from "@/app/api/camera/undo/route";

const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

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

function req(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  for (const room of [
    "Board1 Route Seat",
    "Board1 Route Bleed",
    "Board1 Route Undo",
    "Board1 Route CorrectSeat",
  ]) {
    clearTakeoutHold(room);
    const state = board(room);
    removeServerMatch(state.id);
  }
});

describe("camera routes: 409 seat lock", () => {
  it("POST /dart returns 409 when expectedPlayerIndex mismatches", async () => {
    const state = board("Board1 Route Seat");
    upsertServerMatch(state);
    try {
      expect(
        (
          await postDart(
            req("http://local/api/camera/dart", {
              kind: "triple",
              number: 20,
              roomId: "Board1 Route Seat",
              expectedPlayerIndex: 0,
            })
          )
        ).status
      ).toBe(200);

      expect(
        (
          await postDart(
            req("http://local/api/camera/dart", {
              kind: "single",
              number: 5,
              roomId: "Board1 Route Seat",
              expectedPlayerIndex: 1,
            })
          )
        ).status
      ).toBe(409);
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("POST /end-turn returns 409 on seat mismatch", async () => {
    const state = board("Board1 Route Seat");
    upsertServerMatch(state);
    try {
      await postDart(
        req("http://local/api/camera/dart", {
          kind: "triple",
          number: 20,
          roomId: "Board1 Route Seat",
          expectedPlayerIndex: 0,
        })
      );
      const res = await postEndTurn(
        req("http://local/api/camera/end-turn", {
          roomId: "Board1 Route Seat",
          expectedPlayerIndex: 1,
        })
      );
      expect(res.status).toBe(409);
    } finally {
      removeServerMatch(state.id);
    }
  });
});

describe("camera routes: takeout / bleed correct reject", () => {
  it("POST /correct refuses residual visit onto next thrower", async () => {
    const state = board("Board1 Route Bleed");
    upsertServerMatch(state);
    try {
      for (const n of [20, 5, 1]) {
        const r = await postDart(
          req("http://local/api/camera/dart", {
            kind: "single",
            number: n,
            roomId: "Board1 Route Bleed",
            expectedPlayerIndex: 0,
          })
        );
        expect(r.status).toBe(200);
      }

      const bleed = await postCorrect(
        req("http://local/api/camera/correct", {
          roomId: "Board1 Route Bleed",
          darts: [
            { kind: "single", number: 20 },
            { kind: "single", number: 5 },
            { kind: "single", number: 1 },
          ],
          reason: "takeout_residual",
        })
      );
      // After turnEnded + takeout hold: fail-closed (hold 409 or no-visit 404)
      expect([404, 409]).toContain(bleed.status);
      const body = (await bleed.json()) as { error?: string };
      expect(body.error).toMatch(/No open visit|Takeout hold|Seat mismatch/i);
    } finally {
      removeServerMatch(state.id);
    }
  });
});

describe("camera routes: undo", () => {
  it("POST /undo walks dart-by-dart and 409s when idle", async () => {
    const state = board("Board1 Route Undo");
    upsertServerMatch(state);
    try {
      for (const n of [20, 5]) {
        expect(
          (
            await postDart(
              req("http://local/api/camera/dart", {
                kind: "single",
                number: n,
                roomId: "Board1 Route Undo",
                expectedPlayerIndex: 0,
              })
            )
          ).status
        ).toBe(200);
      }

      const u1 = await postUndo(
        req("http://local/api/camera/undo", { roomId: "Board1 Route Undo" })
      );
      expect(u1.status).toBe(200);
      const b1 = (await u1.json()) as {
        currentPlayerIndex: number;
        currentTurnDarts: unknown[];
      };
      expect(b1.currentPlayerIndex).toBe(0);
      expect(b1.currentTurnDarts).toHaveLength(1);

      const u2 = await postUndo(
        req("http://local/api/camera/undo", { roomId: "Board1 Route Undo" })
      );
      expect(u2.status).toBe(200);
      expect(
        ((await u2.json()) as { currentTurnDarts: unknown[] }).currentTurnDarts
      ).toHaveLength(0);

      const idle = await postUndo(
        req("http://local/api/camera/undo", { roomId: "Board1 Route Undo" })
      );
      expect(idle.status).toBe(409);
      expect(((await idle.json()) as { error?: string }).error).toMatch(
        /Nothing to undo/i
      );
    } finally {
      removeServerMatch(state.id);
    }
  });
});
