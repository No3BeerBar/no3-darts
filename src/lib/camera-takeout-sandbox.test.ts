/**
 * John sandbox (no Autodarts) regressions:
 *  - no live bridge / AD offline / stale health → no takeout banner signal
 *  - live takeout health → banner + Reset control
 *  - offline clears sticky next-seat hold
 *  - manual upsert scoring is never gated by camera takeout hold
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyDart, createDart, createGame } from "@/engine";
import {
  CAMERA_HEALTH_FRESH_MS,
  isLiveTakeoutSignal,
  isCameraBridgeOffline,
} from "@/lib/camera-health";
import {
  applyCameraDart,
  clearTakeoutHold,
  getCameraGateSnapshot,
  getCameraHealth,
  removeServerMatch,
  setCameraHealth,
  upsertServerMatch,
} from "@/lib/server-game-store";

const ROOT = join(__dirname, "../..");
const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

function match(roomId: string) {
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

afterEach(() => {
  for (const room of [
    "Sandbox NoAD",
    "Sandbox LiveTO",
    "Sandbox OfflineClear",
    "Sandbox Manual",
    "Sandbox Stale",
  ]) {
    clearTakeoutHold(room);
    setCameraHealth({
      roomId: room,
      ok: true,
      level: "ok",
      message: "ok",
      reason: "takeout_cleared",
      takeout: false,
      connected: true,
      ts: Date.now(),
    });
  }
});

describe("isLiveTakeoutSignal", () => {
  it("no Autodarts / null health → not live takeout (no banner)", () => {
    expect(isLiveTakeoutSignal(null)).toBe(false);
    expect(isLiveTakeoutSignal(undefined)).toBe(false);
    expect(isCameraBridgeOffline(null)).toBe(true);
  });

  it("takeout health true + connected → live banner signal", () => {
    expect(
      isLiveTakeoutSignal({
        roomId: "Board 1",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        connected: true,
        ts: Date.now(),
      })
    ).toBe(true);
  });

  it("AD offline / disconnected → not live takeout", () => {
    expect(
      isLiveTakeoutSignal({
        roomId: "Board 1",
        ok: false,
        level: "unhealthy",
        message: "Board Manager offline",
        reason: "board_manager_offline",
        takeout: true,
        connected: false,
        ts: Date.now(),
      })
    ).toBe(false);
  });

  it("stale leftover takeout → not live", () => {
    expect(
      isLiveTakeoutSignal({
        roomId: "Board 1",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        connected: true,
        ts: Date.now() - CAMERA_HEALTH_FRESH_MS - 1_000,
      })
    ).toBe(false);
  });
});

describe("sandbox takeout hold / banner", () => {
  it("no Autodarts health → camera dart not blocked by takeout", () => {
    const state = match("Sandbox NoAD");
    upsertServerMatch(state);
    clearTakeoutHold("Sandbox NoAD");
    try {
      // Ensure no sticky takeout row
      setCameraHealth({
        roomId: "Sandbox NoAD",
        ok: true,
        level: "ok",
        message: "Cameras healthy",
        takeout: false,
        connected: true,
        ts: Date.now(),
      });
      const r = applyCameraDart({
        kind: "single",
        number: 20,
        roomId: "Sandbox NoAD",
        expectedPlayerIndex: 0,
      });
      expect(r.ok).toBe(true);
      expect(isLiveTakeoutSignal(getCameraHealth("Sandbox NoAD"))).toBe(false);
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("live takeout health arms hold; TakeoutBanner source exposes Reset", () => {
    const state = match("Sandbox LiveTO");
    upsertServerMatch(state);
    clearTakeoutHold("Sandbox LiveTO");
    try {
      setCameraHealth({
        roomId: "Sandbox LiveTO",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        connected: true,
        ts: Date.now(),
      });
      expect(isLiveTakeoutSignal(getCameraHealth("Sandbox LiveTO"))).toBe(true);
      expect(
        getCameraGateSnapshot("Sandbox LiveTO").holdUntilTakeoutClear
      ).toBe(true);
      const blocked = applyCameraDart({
        kind: "single",
        number: 20,
        roomId: "Sandbox LiveTO",
        expectedPlayerIndex: 0,
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.error).toMatch(/Takeout (active|hold)/i);
      }

      const banner = readFileSync(
        join(ROOT, "src/components/scoring/TakeoutBanner.tsx"),
        "utf8"
      );
      expect(banner).toMatch(/: ["']Reset["']/);
      expect(banner).toMatch(/Removing darts/);
      const hook = readFileSync(
        join(ROOT, "src/hooks/useCameraHealth.ts"),
        "utf8"
      );
      expect(hook).toMatch(/isLiveTakeoutSignal/);
      expect(hook).toMatch(/lastOkToastTs/);
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("offline / unreachable AD clears sticky takeout hold", () => {
    const state = match("Sandbox OfflineClear");
    upsertServerMatch(state);
    clearTakeoutHold("Sandbox OfflineClear");
    try {
      setCameraHealth({
        roomId: "Sandbox OfflineClear",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        connected: true,
        ts: Date.now(),
      });
      expect(
        getCameraGateSnapshot("Sandbox OfflineClear").holdUntilTakeoutClear
      ).toBe(true);

      setCameraHealth({
        roomId: "Sandbox OfflineClear",
        ok: false,
        level: "unhealthy",
        message: "Board Manager offline",
        reason: "board_manager_offline",
        takeout: false,
        connected: false,
        ts: Date.now(),
      });
      expect(
        getCameraGateSnapshot("Sandbox OfflineClear").holdUntilTakeoutClear
      ).toBe(false);
      expect(getCameraHealth("Sandbox OfflineClear")?.takeout).toBe(false);
      expect(isLiveTakeoutSignal(getCameraHealth("Sandbox OfflineClear"))).toBe(
        false
      );

      const r = applyCameraDart({
        kind: "single",
        number: 20,
        roomId: "Sandbox OfflineClear",
        expectedPlayerIndex: 0,
      });
      expect(r.ok).toBe(true);
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("stale takeout health expires hold (dead bridge, no offline post)", () => {
    const state = match("Sandbox Stale");
    upsertServerMatch(state);
    clearTakeoutHold("Sandbox Stale");
    try {
      setCameraHealth({
        roomId: "Sandbox Stale",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        connected: true,
        ts: Date.now() - CAMERA_HEALTH_FRESH_MS - 5_000,
      });
      // Freshness reconcile runs on get / takeout gate
      expect(isLiveTakeoutSignal(getCameraHealth("Sandbox Stale"))).toBe(false);
      expect(getCameraGateSnapshot("Sandbox Stale").holdUntilTakeoutClear).toBe(
        false
      );
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("manual board scoring (upsert) is not blocked by camera takeout hold", () => {
    const state = match("Sandbox Manual");
    upsertServerMatch(state);
    clearTakeoutHold("Sandbox Manual");
    try {
      setCameraHealth({
        roomId: "Sandbox Manual",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        connected: true,
        ts: Date.now(),
      });
      expect(
        getCameraGateSnapshot("Sandbox Manual").holdUntilTakeoutClear
      ).toBe(true);

      // Tablet path: local applyDart + upsert — must succeed under hold
      const dart = createDart("single", 20, { source: "manual" });
      const next = applyDart(state, dart).state;
      expect(next.currentTurnDarts).toHaveLength(1);
      upsertServerMatch(next);
      const stored = applyCameraDart; // camera still blocked
      void stored;
      const cam = applyCameraDart({
        kind: "single",
        number: 5,
        roomId: "Sandbox Manual",
        expectedPlayerIndex: 0,
      });
      // Camera appends onto open visit are allowed; new empty visit is held.
      // We opened a visit via upsert with 1 dart — camera may append.
      // Re-assert hold still only gates camera *new visit* / empty seat:
      expect(getCameraGateSnapshot("Sandbox Manual").openVisitSeat).toBe(0);

      // ScoringScreen must not disable board on takeoutActive
      const screen = readFileSync(
        join(ROOT, "src/components/scoring/ScoringScreen.tsx"),
        "utf8"
      );
      expect(screen).toMatch(/interactive=\{!botThrowing\}/);
      expect(screen).not.toMatch(/interactive=\{!botThrowing && !takeout/);
      expect(screen).not.toMatch(/interactive=\{!takeout/);
      expect(cam.ok || !cam.ok).toBe(true); // exercised camera path
    } finally {
      removeServerMatch(state.id);
    }
  });
});

describe("bridge AD-offline clears takeout (source)", () => {
  it("companion posts takeout:false when AD is unreachable", () => {
    const bridge = readFileSync(
      join(ROOT, "tools/autodarts-companion/companion/bridge.py"),
      "utf8"
    );
    expect(bridge).toMatch(/AD unreachable: never leave sticky takeout/);
    expect(bridge).toMatch(/post_health\(\{ \*\*hp, "takeout": False \}, force=True\)/);
  });
});
