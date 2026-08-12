/**
 * ResumeAuthGate is hook-heavy; cover the seat-auth contract it depends on
 * for "fresh load / resume requires PIN" without a full browser harness.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  canScoreMatch,
  clearSeatAuth,
  invalidateSeatAuthOnPageRestore,
  markSeatVerified,
  seatsNeedingReauth,
  seedSeatAuthForMatch,
} from "@/lib/seat-auth";

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

describe("ResumeAuthGate contract (seat-auth)", () => {
  it("blocks scoring until registered seats re-verify after fresh restore", () => {
    installMemoryStorage();
    const players = [
      { id: "alice", name: "Alice", isGuest: false },
      { id: "bob", name: "Bob", isGuest: false },
      { id: "g1", name: "Guest", isGuest: true },
    ];
    seedSeatAuthForMatch("m-resume", players, "alice");
    expect(canScoreMatch("m-resume", players, "alice")).toBe(true);

    // App kill / fresh load clears scoring trust (cookie alone is not enough)
    invalidateSeatAuthOnPageRestore("m-resume");
    expect(seatsNeedingReauth("m-resume", players, "alice").map((p) => p.id)).toEqual(
      ["alice", "bob"]
    );
    expect(canScoreMatch("m-resume", players, "alice")).toBe(false);

    markSeatVerified("m-resume", "alice", "alice");
    expect(seatsNeedingReauth("m-resume", players, "alice").map((p) => p.id)).toEqual(
      ["bob"]
    );
    expect(canScoreMatch("m-resume", players, "alice")).toBe(false);

    markSeatVerified("m-resume", "bob", "alice");
    expect(seatsNeedingReauth("m-resume", players, "alice")).toEqual([]);
    expect(canScoreMatch("m-resume", players, "alice")).toBe(true);
  });

  it("never asks guests or bots for PIN on resume", () => {
    installMemoryStorage();
    const players = [
      { id: "g1", name: "Walk-up", isGuest: true },
      {
        id: "bot1",
        name: "Luke Littler",
        isGuest: true,
        isBot: true,
        botDifficulty: "luke_littler" as const,
      },
    ];
    seedSeatAuthForMatch("m-guests", players, null);
    invalidateSeatAuthOnPageRestore("m-guests");
    expect(seatsNeedingReauth("m-guests", players, null)).toEqual([]);
    expect(canScoreMatch("m-guests", players, null)).toBe(true);
  });
});
