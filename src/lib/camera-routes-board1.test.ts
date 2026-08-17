/**
 * Board 1 camera route invariants (HTTP status mapping).
 *
 * Exercises /api/camera/{dart,correct,end-turn,undo} POST handlers:
 *   - 409 seat lock / expectedPlayerIndex / takeout hold
 *   - takeout/bleed correct reject
 *   - multi-step undo + 409 when nothing to undo
 *
 * Also covers POST /api/matches/:id/dart (bartender / API path): a full
 * 3-dart visit must score even when expectedPlayerIndex is omitted.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import {
  applyCameraDart,
  clearTakeoutHold,
  getCameraGateSnapshot,
  getServerMatch,
  removeServerMatch,
  requestTakeoutReady,
  setCameraHealth,
  upsertServerMatch,
} from "@/lib/server-game-store";
import { POST as postDart } from "@/app/api/camera/dart/route";
import { POST as postCorrect } from "@/app/api/camera/correct/route";
import { POST as postEndTurn } from "@/app/api/camera/end-turn/route";
import { POST as postUndo } from "@/app/api/camera/undo/route";
import { POST as postMatch } from "@/app/api/matches/route";
import { POST as postMatchDart } from "@/app/api/matches/[id]/dart/route";

const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

const ROOMS = [
  "Board1 Route Seat",
  "Board1 Route Bleed",
  "Board1 Route Undo",
  "Board1 Route CorrectSeat",
  "Board1 Route Takeout",
  "Board1 Match Dart",
];

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

function clearRoom(roomId: string) {
  clearTakeoutHold(roomId);
  setCameraHealth({
    roomId,
    ok: true,
    level: "ok",
    message: "",
    reason: "takeout_cleared",
    takeout: false,
    ts: Date.now(),
  });
}

afterEach(() => {
  for (const room of ROOMS) clearRoom(room);
});

describe("camera routes: 409 seat lock", () => {
  it("POST /dart returns 409 when expectedPlayerIndex mismatches", async () => {
    const state = board("Board1 Route Seat");
    upsertServerMatch(state);
    clearRoom("Board1 Route Seat");
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
              expectedPlayerIndex: 0,
            })
          )
        ).status
      ).toBe(200);

      expect(
        (
          await postEndTurn(
            req("http://local/api/camera/end-turn", {
              roomId: "Board1 Route Seat",
              expectedPlayerIndex: 0,
            })
          )
        ).status
      ).toBe(200);

      const late = await postDart(
        req("http://local/api/camera/dart", {
          kind: "double",
          number: 16,
          roomId: "Board1 Route Seat",
          expectedPlayerIndex: 0,
        })
      );
      expect(late.status).toBe(409);
      const lateBody = (await late.json()) as { error?: string };
      expect(lateBody.error).toMatch(/Seat mismatch|Takeout hold/i);
    } finally {
      removeServerMatch(state.id);
      clearRoom("Board1 Route Seat");
    }
  });

  it("POST /dart 409 when expectedPlayerIndex missing mid-visit", async () => {
    const state = board("Board1 Route Seat");
    upsertServerMatch(state);
    clearRoom("Board1 Route Seat");
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
      const missing = await postDart(
        req("http://local/api/camera/dart", {
          kind: "single",
          number: 5,
          roomId: "Board1 Route Seat",
        })
      );
      expect(missing.status).toBe(409);
      expect(((await missing.json()) as { error?: string }).error).toMatch(
        /expectedPlayerIndex required/i
      );
    } finally {
      removeServerMatch(state.id);
      clearRoom("Board1 Route Seat");
    }
  });

  it("POST /correct returns 409 on wrong seat or bleed reject", async () => {
    const state = board("Board1 Route CorrectSeat");
    upsertServerMatch(state);
    clearRoom("Board1 Route CorrectSeat");
    try {
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId: "Board1 Route CorrectSeat",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        (
          await postEndTurn(
            req("http://local/api/camera/end-turn", {
              roomId: "Board1 Route CorrectSeat",
              expectedPlayerIndex: 0,
            })
          )
        ).status
      ).toBe(200);

      const res = await postCorrect(
        req("http://local/api/camera/correct", {
          roomId: "Board1 Route CorrectSeat",
          expectedPlayerIndex: 0,
          darts: [{ kind: "single", number: 20 }],
          reason: "wrong_seat",
        })
      );
      expect([409, 404]).toContain(res.status);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/Seat mismatch|Takeout hold|No open visit/i);
    } finally {
      removeServerMatch(state.id);
      clearRoom("Board1 Route CorrectSeat");
    }
  });
});

describe("camera routes: fail-closed expectedPlayerIndex", () => {
  it("POST /end-turn 409 when expectedPlayerIndex missing on open visit", async () => {
    const state = board("Board1 Route Seat");
    upsertServerMatch(state);
    clearRoom("Board1 Route Seat");
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
      const missing = await postEndTurn(
        req("http://local/api/camera/end-turn", {
          roomId: "Board1 Route Seat",
        })
      );
      expect(missing.status).toBe(409);
      expect(((await missing.json()) as { error?: string }).error).toMatch(
        /expectedPlayerIndex required/i
      );
    } finally {
      removeServerMatch(state.id);
      clearRoom("Board1 Route Seat");
    }
  });

  it("POST /end-turn 409 when expectedPlayerIndex missing after auto turnEnded", async () => {
    const state = board("Board1 Route Seat");
    upsertServerMatch(state);
    clearRoom("Board1 Route Seat");
    try {
      for (const n of [20, 5, 1]) {
        expect(
          (
            await postDart(
              req("http://local/api/camera/dart", {
                kind: "single",
                number: n,
                roomId: "Board1 Route Seat",
                expectedPlayerIndex: 0,
              })
            )
          ).status
        ).toBe(200);
      }
      const missing = await postEndTurn(
        req("http://local/api/camera/end-turn", {
          roomId: "Board1 Route Seat",
        })
      );
      expect(missing.status).toBe(409);
      expect(((await missing.json()) as { error?: string }).error).toMatch(
        /expectedPlayerIndex required/i
      );
    } finally {
      removeServerMatch(state.id);
      clearRoom("Board1 Route Seat");
    }
  });
});

describe("camera routes: takeout reject", () => {
  it("POST /dart refuses new-visit dart while takeout health / hold active", async () => {
    const state = board("Board1 Route Takeout");
    upsertServerMatch(state);
    clearRoom("Board1 Route Takeout");
    try {
      for (const n of [20, 5]) {
        expect(
          (
            await postDart(
              req("http://local/api/camera/dart", {
                kind: "single",
                number: n,
                roomId: "Board1 Route Takeout",
                expectedPlayerIndex: 0,
              })
            )
          ).status
        ).toBe(200);
      }
      expect(
        (
          await postEndTurn(
            req("http://local/api/camera/end-turn", {
              roomId: "Board1 Route Takeout",
              expectedPlayerIndex: 0,
            })
          )
        ).status
      ).toBe(200);

      setCameraHealth({
        roomId: "Board1 Route Takeout",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        ts: Date.now(),
      });

      const late = await postDart(
        req("http://local/api/camera/dart", {
          kind: "double",
          number: 16,
          roomId: "Board1 Route Takeout",
          expectedPlayerIndex: 1,
        })
      );
      expect([404, 409]).toContain(late.status);
      const body = (await late.json()) as { error?: string };
      expect(body.error).toMatch(/Takeout (active|hold)/i);
    } finally {
      removeServerMatch(state.id);
      clearRoom("Board1 Route Takeout");
    }
  });
});

describe("camera routes: takeout / bleed correct reject", () => {
  it("POST /correct refuses residual visit onto next thrower", async () => {
    const state = board("Board1 Route Bleed");
    upsertServerMatch(state);
    clearRoom("Board1 Route Bleed");
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
      requestTakeoutReady("Board1 Route Bleed");

      const bleed = await postCorrect(
        req("http://local/api/camera/correct", {
          roomId: "Board1 Route Bleed",
          expectedPlayerIndex: 1,
          darts: [
            { kind: "single", number: 20 },
            { kind: "single", number: 5 },
            { kind: "single", number: 1 },
          ],
          reason: "takeout_residual",
        })
      );
      expect([404, 409]).toContain(bleed.status);
      const body = (await bleed.json()) as { error?: string };
      expect(body.error).toMatch(/No open visit/i);
    } finally {
      removeServerMatch(state.id);
      clearRoom("Board1 Route Bleed");
    }
  });
});

describe("camera routes: undo", () => {
  it("POST /undo walks dart-by-dart and 409s when idle", async () => {
    const state = board("Board1 Route Undo");
    upsertServerMatch(state);
    clearRoom("Board1 Route Undo");
    try {
      for (const n of [20, 5, 1]) {
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
      requestTakeoutReady("Board1 Route Undo");

      const u1 = await postUndo(
        req("http://local/api/camera/undo", { roomId: "Board1 Route Undo" })
      );
      expect(u1.status).toBe(200);
      const b1 = (await u1.json()) as {
        currentPlayerIndex: number;
        currentTurnDarts: unknown[];
      };
      expect(b1.currentPlayerIndex).toBe(0);
      expect(b1.currentTurnDarts).toHaveLength(2);

      expect(
        (
          await postUndo(
            req("http://local/api/camera/undo", { roomId: "Board1 Route Undo" })
          )
        ).status
      ).toBe(200);
      expect(
        (
          await postUndo(
            req("http://local/api/camera/undo", { roomId: "Board1 Route Undo" })
          )
        ).status
      ).toBe(200);

      const idle = await postUndo(
        req("http://local/api/camera/undo", { roomId: "Board1 Route Undo" })
      );
      expect(idle.status).toBe(409);
      expect(((await idle.json()) as { error?: string }).error).toMatch(
        /Nothing to undo/i
      );
    } finally {
      removeServerMatch(state.id);
      clearRoom("Board1 Route Undo");
    }
  });
});

async function matchDart(
  id: string,
  body: Record<string, unknown>
) {
  return postMatchDart(
    req(`http://local/api/matches/${id}/dart`, body),
    { params: Promise.resolve({ id }) }
  );
}

describe("match-dart route: full visit via URL match id", () => {
  const room = "Board1 Match Dart";

  it("POST /api/matches/:id/dart scores a 3-dart visit without expectedPlayerIndex", async () => {
    const created = await postMatch(
      req("http://local/api/matches", {
        modeConfig: { mode: "countup", config: { turns: 8 } },
        players: [
          { id: "g1", name: "Guest 1", isGuest: true },
          { id: "g2", name: "Guest 2", isGuest: true },
        ],
        roomId: room,
      })
    );
    expect(created.status).toBe(201);
    const { match } = (await created.json()) as { match: { id: string } };
    clearRoom(room);
    try {
      const first = await matchDart(match.id, { kind: "triple", number: 20 });
      expect(first.status).toBe(200);
      const after1 = getServerMatch(match.id);
      expect(after1?.currentPlayerIndex).toBe(0);
      expect(after1?.currentTurnDarts).toHaveLength(1);
      expect(getCameraGateSnapshot(room).openVisitSeat).toBe(0);

      const second = await matchDart(match.id, { kind: "triple", number: 20 });
      expect(second.status).toBe(200);
      const after2 = getServerMatch(match.id);
      expect(after2?.currentPlayerIndex).toBe(0);
      expect(after2?.currentTurnDarts).toHaveLength(2);
      expect(getCameraGateSnapshot(room).openVisitSeat).toBe(0);

      const third = await matchDart(match.id, { kind: "triple", number: 20 });
      expect(third.status).toBe(200);
      const after3 = getServerMatch(match.id);
      expect(after3?.currentPlayerIndex).toBe(1);
      expect(after3?.currentTurnDarts).toHaveLength(0);
      expect(after3?.playerStates[0]?.score).toBe(180);
    } finally {
      removeServerMatch(match.id);
      clearRoom(room);
    }
  });

  it("honors expectedPlayerIndex and rejects the wrong seat honestly", async () => {
    const created = await postMatch(
      req("http://local/api/matches", {
        modeConfig: { mode: "countup", config: { turns: 8 } },
        players: [
          { id: "g1", name: "Guest 1", isGuest: true },
          { id: "g2", name: "Guest 2", isGuest: true },
        ],
        roomId: room,
      })
    );
    expect(created.status).toBe(201);
    const { match } = (await created.json()) as { match: { id: string } };
    clearRoom(room);
    try {
      expect(
        (
          await matchDart(match.id, {
            kind: "triple",
            number: 20,
            expectedPlayerIndex: 0,
          })
        ).status
      ).toBe(200);

      const wrong = await matchDart(match.id, {
        kind: "single",
        number: 5,
        expectedPlayerIndex: 1,
      });
      expect(wrong.status).toBe(409);
      expect(((await wrong.json()) as { error?: string }).error).toMatch(
        /Seat mismatch|expectedPlayerIndex/i
      );

      const live = getServerMatch(match.id);
      expect(live?.currentPlayerIndex).toBe(0);
      expect(live?.currentTurnDarts).toHaveLength(1);

      const sameSeat = await matchDart(match.id, {
        kind: "single",
        number: 5,
        expectedPlayerIndex: 0,
      });
      expect(sameSeat.status).toBe(200);
      expect(getServerMatch(match.id)?.currentTurnDarts).toHaveLength(2);
    } finally {
      removeServerMatch(match.id);
      clearRoom(room);
    }
  });
});
