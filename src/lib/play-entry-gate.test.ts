/**
 * John Board 1 repro: sticky cookie + seat auth + fresh /play hydrate must
 * require PIN and must not appear freely signed in.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@/engine";
import {
  canScoreMatch,
  clearSeatAuth,
  getSeatAuth,
  seatsNeedingReauth,
  seedSeatAuthForMatch,
} from "@/lib/seat-auth";
import { getActiveGame, setActiveGame } from "@/lib/storage";
import {
  clearTabletSessionPlayers,
  getTabletSessionPlayers,
  isTabletSessionCold,
  rememberTabletSessionPlayer,
} from "@/lib/tablet-session";
import {
  gatePlayDocumentEntry,
  playDocumentEntryAlreadyGated,
  resetPlayDocumentEntryGateForTests,
} from "@/lib/play-entry-gate";

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
  clearTabletSessionPlayers();
  resetPlayDocumentEntryGateForTests();
  memory.clear();
  vi.restoreAllMocks();
});

function stickyMatch() {
  return createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    players: [
      { id: "john", name: "John", isGuest: false },
      { id: "bob", name: "Bob", isGuest: true },
    ],
  });
}

describe("play document entry gate (Board /play link)", () => {
  it("sticky cookie + seat auth + fresh hydrate → needs PIN / not freely signed in", async () => {
    installMemoryStorage();

    const state = stickyMatch();
    setActiveGame(state);
    seedSeatAuthForMatch(state.id, state.players, "john");
    rememberTabletSessionPlayer({ id: "john", name: "John" });

    // Pre-condition: continuous kiosk looked fully signed in + trusted
    expect(getActiveGame()?.id).toBe(state.id);
    expect(getSeatAuth()?.verifiedPlayerIds).toContain("john");
    expect(canScoreMatch(state.id, state.players, "john")).toBe(true);
    expect(isTabletSessionCold(null, getTabletSessionPlayers())).toBe(false);

    // Simulate sticky /api/auth/me still returning John until logout runs
    let loggedOut = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/auth/logout") && init?.method === "POST") {
          loggedOut = true;
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/auth/me")) {
          // Cookie would still answer John if we trusted it — gate must not.
          return new Response(
            JSON.stringify({
              ok: true,
              player: loggedOut
                ? null
                : {
                    id: "john",
                    name: "John",
                    createdAt: 1,
                    stats: {
                      matchesPlayed: 0,
                      matchesWon: 0,
                      legsWon: 0,
                      dartsThrown: 0,
                      totalScore: 0,
                      oneEighties: 0,
                      checkoutsHit: 0,
                      checkoutAttempts: 0,
                      highestCheckout: 0,
                      bestThreeDartAvg: 0,
                    },
                  },
              dbConfigured: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/api/players")) {
          return new Response(
            JSON.stringify({ dbConfigured: true, dbAvailable: true, players: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/api/matches")) {
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 404 });
      })
    );

    const { useGameStore } = await import("@/store/game-store");
    const { useSessionStore } = await import("@/store/session-store");

    useGameStore.setState({
      state: null,
      hydrated: false,
      displayOnly: false,
      lastCallout: null,
      lastHighlight: null,
    });
    useSessionStore.setState({
      player: {
        id: "john",
        name: "John",
        createdAt: 1,
        stats: {
          matchesPlayed: 0,
          matchesWon: 0,
          legsWon: 0,
          dartsThrown: 0,
          totalScore: 0,
          oneEighties: 0,
          checkoutsHit: 0,
          checkoutAttempts: 0,
          highestCheckout: 0,
          bestThreeDartAvg: 0,
        },
      },
      tabletPlayers: [{ id: "john", name: "John" }],
      dbConfigured: true,
      dbAvailable: true,
      hydrated: false,
      loading: false,
    });

    // Fresh document: game hydrate + play-entry session hydrate (as /play does)
    useGameStore.getState().hydrate();
    await useSessionStore.getState().hydrate({ playEntry: true });

    expect(playDocumentEntryAlreadyGated()).toBe(true);
    expect(loggedOut).toBe(true);

    // Scoring trust cleared — ResumeAuthGate must ask for PIN
    expect(getSeatAuth()).toMatchObject({
      matchId: state.id,
      verifiedPlayerIds: [],
      boundSessionPlayerId: null,
    });
    expect(seatsNeedingReauth(state.id, state.players, "john")).toEqual([
      { id: "john", name: "John" },
    ]);
    expect(canScoreMatch(state.id, state.players, "john")).toBe(false);

    // Visible "Signed in" chrome must be cold (cookie/roster gated)
    expect(useSessionStore.getState().player).toBeNull();
    expect(useSessionStore.getState().tabletPlayers).toEqual([]);
    expect(getTabletSessionPlayers()).toEqual([]);
    expect(isTabletSessionCold(null)).toBe(true);

    // Continuous SPA: gate already consumed — must not wipe post-PIN trust/roster
    rememberTabletSessionPlayer({ id: "john", name: "John" });
    seedSeatAuthForMatch(state.id, state.players, "john");
    const again = gatePlayDocumentEntry();
    expect(again.gated).toBe(false);
    expect(getTabletSessionPlayers().map((p) => p.id)).toEqual(["john"]);
    expect(getSeatAuth()?.verifiedPlayerIds).toContain("john");
    expect(canScoreMatch(state.id, state.players, "john")).toBe(true);
  });

  it("idle /play (no active match) still clears sticky signed-in chrome once", () => {
    installMemoryStorage();
    rememberTabletSessionPlayer({ id: "john", name: "John" });
    seedSeatAuthForMatch(
      "stale",
      [{ id: "john", name: "John", isGuest: false }],
      "john"
    );

    const first = gatePlayDocumentEntry();
    expect(first.gated).toBe(true);
    expect(getTabletSessionPlayers()).toEqual([]);
    expect(getSeatAuth()).toBeNull();
    expect(isTabletSessionCold(null)).toBe(true);

    rememberTabletSessionPlayer({ id: "john", name: "John" });
    const second = gatePlayDocumentEntry();
    expect(second.gated).toBe(false);
    // Continuous SPA keep roster after re-PIN
    expect(getTabletSessionPlayers().map((p) => p.id)).toEqual(["john"]);
  });
});
