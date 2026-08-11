import { afterEach, describe, expect, it } from "vitest";
import {
  clearTabletSessionPlayers,
  getTabletSessionPlayers,
  isOnTabletSession,
  isTabletSessionCold,
  rememberTabletSessionPlayer,
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

  it("is cold only with no session and empty roster", () => {
    installMemoryStorage();
    expect(isTabletSessionCold(null)).toBe(true);
    expect(isTabletSessionCold("alice")).toBe(false);
    rememberTabletSessionPlayer({ id: "b", name: "Bob" });
    expect(isTabletSessionCold(null)).toBe(false);
  });
});
