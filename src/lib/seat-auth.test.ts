import { afterEach, describe, expect, it } from "vitest";
import {
  canScoreMatch,
  clearSeatAuth,
  effectiveVerifiedSeatIds,
  getSeatAuth,
  invalidateSeat,
  markSeatVerified,
  seatsNeedingReauth,
  seedSeatAuthForMatch,
  setSeatAuth,
  type SeatAuthState,
} from "./seat-auth";

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
});

describe("seat auth / resume re-verification", () => {
  it("allows pure guest matches without PIN", () => {
    installMemoryStorage();
    const players = [
      { id: "g1", name: "Walk-up", isGuest: true },
      { id: "g2", name: "Friend", isGuest: true },
    ];
    expect(seatsNeedingReauth("m1", players, null)).toEqual([]);
    expect(canScoreMatch("m1", players, null)).toBe(true);
  });

  it("seeds registered seats at match start and allows scoring while session matches", () => {
    installMemoryStorage();
    const players = [
      { id: "alice", name: "Alice", isGuest: false },
      { id: "g1", name: "Guest", isGuest: true },
    ];
    seedSeatAuthForMatch("m1", players, "alice");
    expect(seatsNeedingReauth("m1", players, "alice")).toEqual([]);
    expect(canScoreMatch("m1", players, "alice")).toBe(true);
  });

  it("blocks resume after sign-out of the PIN player (John iPad repro)", () => {
    installMemoryStorage();
    const players = [
      { id: "alice", name: "Alice", isGuest: false },
      { id: "bob", name: "Bob", isGuest: true },
    ];
    // 1–3: signed in, start match, leave UI (seat auth persists with active game)
    seedSeatAuthForMatch("m1", players, "alice");
    expect(canScoreMatch("m1", players, "alice")).toBe(true);

    // 4: sign out — seat invalidated + bound session cleared
    invalidateSeat("alice");
    expect(getSeatAuth()).toMatchObject({
      matchId: "m1",
      verifiedPlayerIds: [],
      boundSessionPlayerId: null,
    });

    // 5: resume with nobody signed in — must not score under Alice
    expect(seatsNeedingReauth("m1", players, null)).toEqual([
      { id: "alice", name: "Alice" },
    ]);
    expect(canScoreMatch("m1", players, null)).toBe(false);
  });

  it("treats lost session cookie as unsigned even if seat list was not cleared", () => {
    installMemoryStorage();
    const players = [{ id: "alice", name: "Alice", isGuest: false }];
    const stale: SeatAuthState = {
      matchId: "m1",
      verifiedPlayerIds: ["alice"],
      boundSessionPlayerId: "alice",
    };
    setSeatAuth(stale);
    // Cookie cleared externally — bound session no longer matches
    expect(effectiveVerifiedSeatIds("m1", stale, null)).toEqual([]);
    expect(seatsNeedingReauth("m1", players, null, stale)).toEqual([
      { id: "alice", name: "Alice" },
    ]);
  });

  it("only requires PIN for registered seats in a mixed match", () => {
    installMemoryStorage();
    const players = [
      { id: "alice", name: "Alice", isGuest: false },
      { id: "bob", name: "Bob", isGuest: false },
      { id: "g1", name: "Guest", isGuest: true },
    ];
    seedSeatAuthForMatch("m1", players, "alice");
    invalidateSeat("bob");
    expect(seatsNeedingReauth("m1", players, "alice")).toEqual([
      { id: "bob", name: "Bob" },
    ]);
    markSeatVerified("m1", "bob", "alice");
    expect(seatsNeedingReauth("m1", players, "alice")).toEqual([]);
  });

  it("ignores seat auth from a different match id", () => {
    installMemoryStorage();
    seedSeatAuthForMatch(
      "old",
      [{ id: "alice", name: "Alice", isGuest: false }],
      "alice"
    );
    const players = [{ id: "alice", name: "Alice", isGuest: false }];
    expect(seatsNeedingReauth("new", players, null)).toEqual([
      { id: "alice", name: "Alice" },
    ]);
  });
});
