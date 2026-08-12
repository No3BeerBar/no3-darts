import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@/engine";
import {
  abandonMatchAction,
  canShowTournamentLaneStart,
  needsAbandonConfirm,
} from "./clear-active-match";
import { getActiveGame, setActiveGame } from "./storage";
import { clearSeatAuth, getSeatAuth, seedSeatAuthForMatch } from "./seat-auth";

const memory = new Map<string, string>();

function installMemoryStorage() {
  memory.clear();
  const storage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v);
    },
    removeItem: (k: string) => {
      memory.delete(k);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
  });
}

afterEach(() => {
  clearSeatAuth();
  memory.clear();
  vi.restoreAllMocks();
});

function freshMatch() {
  return createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    players: [
      { id: "alice", name: "Alice", isGuest: false },
      { id: "bob", name: "Bob", isGuest: true },
    ],
  });
}

describe("abandon match / clear paths", () => {
  it("skips confirm when no scoring has started", () => {
    const state = freshMatch();
    expect(needsAbandonConfirm(state)).toBe(false);
    expect(abandonMatchAction(state)).toBe("clear");
    expect(abandonMatchAction(null)).toBe("clear");
  });

  it("requires confirm after a visit has started", () => {
    const state = freshMatch();
    expect(
      needsAbandonConfirm({
        ...state,
        currentTurnDarts: [
          {
            id: "d1",
            kind: "single",
            number: 20,
            value: 20,
            timestamp: 1,
          },
        ],
      })
    ).toBe(true);
    expect(
      abandonMatchAction({
        ...state,
        turns: [
          {
            playerId: "alice",
            darts: [],
            startScore: 501,
            endScore: 501,
            bust: false,
            checkout: false,
            timestamp: 1,
          },
        ],
      })
    ).toBe("confirm");
  });

  it("hides tournament lane start on cold patron play", () => {
    expect(canShowTournamentLaneStart(false)).toBe(false);
    expect(canShowTournamentLaneStart(true)).toBe(true);
  });

  it("hydrate of an active match clears seat scoring trust (fresh load / app kill)", async () => {
    installMemoryStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    );

    const state = freshMatch();
    setActiveGame(state);
    seedSeatAuthForMatch(state.id, state.players, "alice");
    expect(getSeatAuth()?.verifiedPlayerIds).toContain("alice");

    const { useGameStore } = await import("@/store/game-store");
    useGameStore.setState({
      state: null,
      hydrated: false,
      displayOnly: false,
      lastCallout: null,
      lastHighlight: null,
    });

    useGameStore.getState().hydrate();

    expect(useGameStore.getState().hydrated).toBe(true);
    expect(useGameStore.getState().state?.id).toBe(state.id);
    expect(getSeatAuth()).toMatchObject({
      matchId: state.id,
      verifiedPlayerIds: [],
      boundSessionPlayerId: null,
    });
    // Second hydrate is a no-op (continuous session mid-match)
    seedSeatAuthForMatch(state.id, state.players, "alice");
    useGameStore.getState().hydrate();
    expect(getSeatAuth()?.verifiedPlayerIds).toContain("alice");
  });

  it("clearGame removes no3_active_game and seat-auth (End game / Cancel path)", async () => {
    installMemoryStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    );

    const state = freshMatch();
    setActiveGame(state);
    seedSeatAuthForMatch(state.id, state.players, "alice");
    expect(getActiveGame()?.id).toBe(state.id);
    expect(getSeatAuth()?.matchId).toBe(state.id);

    // Import after storage is mocked so hydrate/persist see localStorage
    const { useGameStore } = await import("@/store/game-store");
    useGameStore.setState({
      state,
      hydrated: true,
      displayOnly: false,
      lastCallout: null,
      lastHighlight: null,
    });

    useGameStore.getState().clearGame();

    expect(useGameStore.getState().state).toBeNull();
    expect(getActiveGame()).toBeNull();
    expect(getSeatAuth()).toBeNull();
    expect(memory.has("no3_active_game")).toBe(false);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/matches"))).toBe(
      true
    );
  });

  it("clearGame is a no-op in displayOnly (TV) so play tablets must unset it", async () => {
    installMemoryStorage();
    const state = freshMatch();
    setActiveGame(state);
    const { useGameStore } = await import("@/store/game-store");
    useGameStore.setState({
      state,
      hydrated: true,
      displayOnly: true,
      lastCallout: null,
      lastHighlight: null,
    });

    useGameStore.getState().clearGame();
    expect(useGameStore.getState().state?.id).toBe(state.id);
    expect(getActiveGame()?.id).toBe(state.id);

    useGameStore.getState().setDisplayOnly(false);
    useGameStore.getState().clearGame();
    expect(useGameStore.getState().state).toBeNull();
    expect(getActiveGame()).toBeNull();
  });
});
