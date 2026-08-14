import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearTabletSessionPlayers,
  getTabletSessionPlayers,
  isOnTabletSession,
  isTabletSessionCold,
  rememberRegisteredSeats,
  rememberTabletSessionPlayer,
  signedInLobbyPlayers,
} from "./tablet-session";

const memory = new Map<string, string>();

function installMemoryStorage() {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, v);
      },
      removeItem: (k: string) => {
        memory.delete(k);
      },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
  });
}

afterEach(() => {
  clearTabletSessionPlayers();
  memory.clear();
});

describe("tablet session roster", () => {
  it("remembers PIN-verified players until cleared", () => {
    installMemoryStorage();
    rememberTabletSessionPlayer({ id: "a", name: "Alice" });
    rememberTabletSessionPlayer({ id: "b", name: "Bob" });
    expect(getTabletSessionPlayers().map((p) => p.id)).toEqual(["b", "a"]);
    expect(isOnTabletSession("a")).toBe(true);
    expect(isTabletSessionCold(null)).toBe(false);
    clearTabletSessionPlayers();
    expect(isTabletSessionCold(null)).toBe(true);
  });

  it("keeps every registered seat on the lobby, not just the first", () => {
    installMemoryStorage();
    rememberRegisteredSeats([
      { id: "a", name: "Alice", isGuest: false },
      { id: "b", name: "Bob", isGuest: false },
      { id: "g", name: "Guest", isGuest: true },
    ]);
    expect(getTabletSessionPlayers().map((p) => p.id).sort()).toEqual(["a", "b"]);
    const lobby = signedInLobbyPlayers({ id: "a", name: "Alice" });
    expect(lobby.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(lobby).toHaveLength(2);
  });

  it("idle /play lists the full signed-in lobby", () => {
    const screen = readFileSync(
      join(__dirname, "../components/scoring/ScoringScreen.tsx"),
      "utf8"
    );
    expect(screen).toMatch(/signedInLobbyPlayers/);
    expect(screen).toMatch(/play-idle-signed-in/);
    const store = readFileSync(join(__dirname, "../store/game-store.ts"), "utf8");
    expect(store).toMatch(/rememberRegisteredSeats/);
    expect(store).toMatch(/rememberMatchSeatsOnTablet/);
  });

  it("is cold only with no session and empty roster", () => {
    installMemoryStorage();
    expect(isTabletSessionCold(null)).toBe(true);
    expect(isTabletSessionCold("alice")).toBe(false);
    rememberTabletSessionPlayer({ id: "b", name: "Bob" });
    expect(isTabletSessionCold(null)).toBe(false);
  });
});
