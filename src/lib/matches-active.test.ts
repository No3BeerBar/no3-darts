import { afterEach, describe, expect, it } from "vitest";
import { createGame, type GameState } from "@/engine";
import { GET } from "@/app/api/matches/active/route";
import {
  MATCH_WON_ACTIVE_MS,
  getActiveByRoom,
  resetServerGameStore,
  upsertServerMatch,
  removeServerMatch,
} from "@/lib/server-game-store";

function boardMatch(roomId: string, status: GameState["status"] = "playing"): GameState {
  const state = createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    players: [
      { id: "a", name: "Alice", isGuest: true },
      { id: "b", name: "Bob", isGuest: true },
    ],
    roomId,
  });
  return { ...state, status, updatedAt: Date.now() };
}

async function activeFor(room: string) {
  const res = await GET(
    new Request(
      `http://localhost/api/matches/active?room=${encodeURIComponent(room)}`
    )
  );
  return res.json() as Promise<{ match: GameState | null }>;
}

afterEach(() => {
  resetServerGameStore();
});

describe("GET /api/matches/active after finish / abandon", () => {
  it("returns the live match for Board 1 while playing", async () => {
    const state = boardMatch("Board 1");
    upsertServerMatch(state);
    const data = await activeFor("Board 1");
    expect(data.match?.id).toBe(state.id);
    expect(data.match?.status).toBe("playing");
  });

  it("returns null for the room after finish (status finished upsert)", async () => {
    const state = boardMatch("Board 1");
    upsertServerMatch(state);
    upsertServerMatch({ ...state, status: "finished", updatedAt: Date.now() });
    const data = await activeFor("Board 1");
    expect(data.match).toBeNull();
    expect(getActiveByRoom("Board 1")).toBeUndefined();
  });

  it("returns null after DELETE / abandon and ignores a late playing heartbeat", async () => {
    const state = boardMatch("Board 1");
    upsertServerMatch(state);
    removeServerMatch(state.id);
    expect((await activeFor("Board 1")).match).toBeNull();

    upsertServerMatch({
      ...state,
      status: "playing",
      updatedAt: Date.now() + 10_000,
    });
    expect((await activeFor("Board 1")).match).toBeNull();
    expect(getActiveByRoom("Board 1")).toBeUndefined();
  });

  it("still accepts a new match id on the same room after clear", async () => {
    const first = boardMatch("Board 1");
    upsertServerMatch(first);
    removeServerMatch(first.id);
    const next = boardMatch("Board 1");
    upsertServerMatch(next);
    const data = await activeFor("Board 1");
    expect(data.match?.id).toBe(next.id);
  });

  it("does not keep match_won active forever (brief linger then null)", async () => {
    const wonAt = 1_000_000;
    const state = {
      ...boardMatch("Board 1", "match_won"),
      updatedAt: wonAt,
    };
    upsertServerMatch(state);
    expect(getActiveByRoom("Board 1", wonAt + 500)?.id).toBe(state.id);
    expect(
      getActiveByRoom("Board 1", wonAt + MATCH_WON_ACTIVE_MS + 1)
    ).toBeUndefined();
  });

  it("resolves Board%201 to the Board 1 match", async () => {
    const state = boardMatch("Board 1");
    upsertServerMatch(state);
    expect(getActiveByRoom("Board%201")?.id).toBe(state.id);
    const data = await activeFor("Board%201");
    expect(data.match?.id).toBe(state.id);
  });

  it("does not drop a playing match on a fresh poll (live scoring)", async () => {
    const state = boardMatch("Board 1");
    upsertServerMatch(state);
    const later = Date.now() + 60_000;
    expect(getActiveByRoom("Board 1", later)?.id).toBe(state.id);
  });
});
