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
  healthIndicatesTakeout,
  isAutodartsRemoveDartsStatus,
  isLiveTakeoutSignal,
  isCameraBridgeOffline,
  shouldShowTakeoutUi,
  statusLooksLikeTakeout,
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

  it("takeout && connected!==false && fresh ts → live", () => {
    expect(CAMERA_HEALTH_FRESH_MS).toBe(30_000);
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
    // connected undefined still allowed (not === false)
    expect(
      isLiveTakeoutSignal({
        roomId: "Board 1",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        takeout: true,
        ts: Date.now(),
      })
    ).toBe(true);
  });

  it("AD offline / connected===false → not live takeout", () => {
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
    expect(
      isLiveTakeoutSignal({
        roomId: "Board 1",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        takeout: true,
        connected: false,
        ts: Date.now(),
      })
    ).toBe(false);
  });

  it("AD status Reset / Removing darts is live even when takeout:false (undo desync)", () => {
    expect(statusLooksLikeTakeout("Reset")).toBe(true);
    expect(statusLooksLikeTakeout("Removing darts")).toBe(true);
    expect(statusLooksLikeTakeout("Takeout finished")).toBe(false);
    expect(statusLooksLikeTakeout("Throw")).toBe(false);
    expect(
      isLiveTakeoutSignal({
        roomId: "Board 1",
        ok: true,
        level: "ok",
        message: "Cameras healthy",
        takeout: false,
        status: "Reset",
        connected: true,
        ts: Date.now(),
      })
    ).toBe(true);
    expect(
      shouldShowTakeoutUi({
        roomId: "Board 1",
        ok: true,
        level: "ok",
        message: "Cameras healthy",
        takeout: false,
        status: "Removing darts",
        connected: true,
        ts: Date.now(),
      })
    ).toBe(true);
    // Explicit Ready / takeout_cleared wins so Reset can dismiss
    expect(
      isLiveTakeoutSignal({
        roomId: "Board 1",
        ok: true,
        level: "ok",
        message: "Ready for next visit",
        reason: "takeout_cleared",
        takeout: false,
        status: "Removing darts",
        connected: true,
        ts: Date.now(),
      })
    ).toBe(false);
  });

  it("stale leftover takeout (>30s) → not live", () => {
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

  it("Autodarts yellow Reset is live takeout even without takeout:true", () => {
    expect(isAutodartsRemoveDartsStatus("Reset")).toBe(true);
    expect(isAutodartsRemoveDartsStatus("Takeout")).toBe(true);
    expect(isAutodartsRemoveDartsStatus("Takeout finished")).toBe(false);
    expect(
      healthIndicatesTakeout({
        takeout: false,
        level: "ok",
        reason: "",
        status: "Reset",
        message: "Throw",
      })
    ).toBe(true);
    expect(
      isLiveTakeoutSignal({
        roomId: "Board 1",
        ok: true,
        level: "ok",
        message: "Cameras healthy",
        status: "Reset",
        takeout: false,
        connected: true,
        ts: Date.now(),
      })
    ).toBe(true);
    expect(
      healthIndicatesTakeout({
        takeout: false,
        level: "ok",
        reason: "takeout_cleared",
        status: "Throw",
        message: "Takeout reset - ready for next visit",
      })
    ).toBe(false);
  });

  it("never hides an already-showing takeout banner on a missed poll", () => {
    expect(
      shouldShowTakeoutUi({ health: null, currentlyShowing: true })
    ).toBe(true);
    expect(
      shouldShowTakeoutUi({ health: null, currentlyShowing: false })
    ).toBe(false);
    expect(
      shouldShowTakeoutUi({
        health: {
          roomId: "Board 1",
          ok: true,
          level: "ok",
          message: "Takeout reset - ready for next visit",
          reason: "takeout_cleared",
          takeout: false,
          connected: true,
          ts: Date.now(),
        },
        currentlyShowing: true,
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

  it("yellow Autodarts Reset health arms takeout hold + banner signal", () => {
    setCameraHealth({
      roomId: "Sandbox LiveTO",
      ok: true,
      level: "ok",
      message: "Cameras healthy",
      status: "Reset",
      takeout: false,
      connected: true,
      ts: Date.now(),
    });
    const h = getCameraHealth("Sandbox LiveTO");
    expect(isLiveTakeoutSignal(h)).toBe(true);
    expect(h?.takeout).toBe(true);
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
      expect(banner).toMatch(/: ["']Reset takeout["']/);
      expect(banner).toMatch(/Removing darts/);
      const hook = readFileSync(
        join(ROOT, "src/hooks/useCameraHealth.ts"),
        "utf8"
      );
      expect(hook).toMatch(/shouldShowTakeoutUi/);
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

  it("manual board taps NEVER blocked by takeout hold (camera only)", () => {
    let state = match("Sandbox Manual");
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

      // Camera new-visit blocked
      const camBlocked = applyCameraDart({
        kind: "single",
        number: 20,
        roomId: "Sandbox Manual",
        expectedPlayerIndex: 0,
      });
      expect(camBlocked.ok).toBe(false);
      if (!camBlocked.ok) {
        expect(camBlocked.error).toMatch(/Takeout (active|hold)/i);
      }

      // Tablet path: local applyDart + upsert — must succeed under hold
      for (const n of [20, 5, 1] as const) {
        const dart = createDart("single", n, { source: "manual" });
        state = applyDart(state, dart).state;
        upsertServerMatch(state);
      }
      expect(state.currentPlayerIndex).toBe(1);
      expect(state.currentTurnDarts).toHaveLength(0);

      // ScoringScreen must not disable board on takeoutActive
      const screen = readFileSync(
        join(ROOT, "src/components/scoring/ScoringScreen.tsx"),
        "utf8"
      );
      expect(screen).toMatch(/interactive=\{!botThrowing\}/);
      expect(screen).not.toMatch(/interactive=\{!botThrowing && !takeout/);
      expect(screen).not.toMatch(/interactive=\{!takeout/);
      expect(screen).toMatch(/source:\s*["']manual["']/);
      expect(screen).toMatch(/data-testid="play-board-reset"/);
      expect(screen).toMatch(/useCameraHealth\(cameraRoom,\s*true\)/);
    } finally {
      removeServerMatch(state.id);
    }
  });
});

describe("bridge AD-offline clears takeout (source)", () => {
  it("companion posts takeout:false + connected:false; still handles Ready ack", () => {
    const bridge = readFileSync(
      join(ROOT, "tools/autodarts-companion/companion/bridge.py"),
      "utf8"
    );
    expect(bridge).toMatch(/AD unreachable: ALWAYS clear sticky takeout/);
    expect(bridge).toContain('"takeout": False');
    expect(bridge).toContain('"connected": False');
    expect(bridge).toContain('handle_takeout_ready_ack(prev_status or "", [])');
    const ackStart = bridge.indexOf("def handle_takeout_ready_ack");
    const ackEnd = bridge.indexOf("\n    def ", ackStart + 1);
    const ack = bridge.slice(ackStart, ackEnd);
    expect(ack).toContain("try_start_detection");
    expect(ack).not.toContain("maybe_end_turn");
    expect(ack).not.toContain("maybe_between_games_recal(");
    expect(bridge).toContain("ad_takeout: bool = False");
    expect(bridge).toContain("if active and not ad_ok:");
    expect(bridge).toContain("if active and not ad_takeout and not frozen_visit:");
  });
});

describe("TV takeout prominence (John watches /tv)", () => {
  it("TV mounts big Removing darts banner only via live takeout signal", () => {
    const banner = readFileSync(
      join(ROOT, "src/components/tv/TvTakeoutBanner.tsx"),
      "utf8"
    );
    expect(banner).toMatch(/Removing darts/);
    expect(banner).toMatch(/Reset/);
    expect(banner).toMatch(/text-4xl|text-5xl|text-6xl/);
    const feed = readFileSync(
      join(ROOT, "src/hooks/useTvMatchFeed.ts"),
      "utf8"
    );
    expect(feed).toMatch(/shouldShowTakeoutUi/);
    expect(feed).toMatch(/setTakeoutActive\(false\)/);
    expect(feed).toMatch(/Missed poll must not hide/);
    const tv = readFileSync(
      join(ROOT, "src/components/tv/TvDisplay.tsx"),
      "utf8"
    );
    expect(tv).toMatch(/TvTakeoutBanner/);
    expect(tv).toMatch(/takeoutActive/);
    expect(tv).toMatch(/takeoutVisitDisplay/);
    expect(banner).toMatch(/last visit/);
    expect(banner).not.toMatch(/fixed inset-0/);
  });
});
