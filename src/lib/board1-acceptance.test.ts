/**
 * Board 1 / camera-bridge acceptance net - John P0s only.
 *
 * 1. Takeout / removing-darts recognized; scoring paused; Ready resets.
 * 2. A 3-dart AD visit can never apply dart 3 to the next No3 seat.
 *
 * Companion: tools/autodarts-companion/tests/test_board1_acceptance.py
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import {
  applyCameraDart,
  applyCameraEndTurn,
  clearTakeoutHold,
  removeServerMatch,
  requestTakeoutReady,
  setCameraHealth,
  upsertServerMatch,
} from "@/lib/server-game-store";

const ROOT = join(__dirname, "../..");

const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

function board1Match(roomId: string) {
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

function readSrc(...parts: string[]) {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

afterEach(() => {
  for (const room of ["Board1 Accept Seat", "Board1 Takeout Pause"]) {
    clearTakeoutHold(room);
    setCameraHealth({
      roomId: room,
      ok: true,
      level: "ok",
      message: "Ready for next visit",
      reason: "takeout_cleared",
      takeout: false,
      ts: Date.now(),
    });
  }
});

describe("Board1 P0: takeout recognize + Ready control", () => {
  it("TakeoutBanner exposes Ready reset (not a passive-only banner)", () => {
    const banner = readSrc("src/components/scoring/TakeoutBanner.tsx");
    expect(banner).toMatch(/Removing darts/);
    expect(banner).toMatch(/"Ready"/);
    expect(banner).toMatch(/onReady/);
    const screen = readSrc("src/components/scoring/ScoringScreen.tsx");
    expect(screen).toMatch(/TakeoutBanner/);
    expect(screen).toMatch(/acknowledgeTakeout/);
    const hook = readSrc("src/hooks/useCameraHealth.ts");
    expect(hook).toMatch(/takeout-ready/);
    expect(hook).toMatch(/acknowledgeTakeout/);
  });

  it("takeout health + hold pause scoring on an empty next-seat visit", () => {
    const state = board1Match("Board1 Takeout Pause");
    upsertServerMatch(state);
    clearTakeoutHold("Board1 Takeout Pause");
    try {
      // Advance to Bob with empty visit (premature end after 2 - the race)
      expect(
        applyCameraDart({
          kind: "triple",
          number: 20,
          roomId: "Board1 Takeout Pause",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board1 Takeout Pause",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraEndTurn({
          roomId: "Board1 Takeout Pause",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      setCameraHealth({
        roomId: "Board1 Takeout Pause",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        ts: Date.now(),
      });

      const lateThird = applyCameraDart({
        kind: "double",
        number: 16,
        roomId: "Board1 Takeout Pause",
        expectedPlayerIndex: 1,
      });
      expect(lateThird.ok).toBe(false);
      if (!lateThird.ok) {
        expect(lateThird.error).toMatch(/Takeout (active|hold)/i);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board1 Takeout Pause");
    }
  });

  it("still accepts dart 3 on the open seat while takeout health is active", () => {
    const state = board1Match("Board1 Takeout Pause");
    upsertServerMatch(state);
    clearTakeoutHold("Board1 Takeout Pause");
    try {
      expect(
        applyCameraDart({
          kind: "triple",
          number: 20,
          roomId: "Board1 Takeout Pause",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board1 Takeout Pause",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      setCameraHealth({
        roomId: "Board1 Takeout Pause",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        ts: Date.now(),
      });

      // Incomplete visit still open - dart 3 must finish this seat
      const third = applyCameraDart({
        kind: "double",
        number: 16,
        roomId: "Board1 Takeout Pause",
        expectedPlayerIndex: 0,
      });
      expect(third.ok).toBe(true);
      if (third.ok) {
        expect(third.turnEnded).toBe(true);
        expect(third.state.currentPlayerIndex).toBe(1);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board1 Takeout Pause");
    }
  });

  it("Ready releases hold so the next seat can start", () => {
    const state = board1Match("Board1 Takeout Pause");
    upsertServerMatch(state);
    clearTakeoutHold("Board1 Takeout Pause");
    try {
      applyCameraDart({
        kind: "single",
        number: 20,
        roomId: "Board1 Takeout Pause",
        expectedPlayerIndex: 0,
      });
      applyCameraDart({
        kind: "single",
        number: 5,
        roomId: "Board1 Takeout Pause",
        expectedPlayerIndex: 0,
      });
      applyCameraDart({
        kind: "single",
        number: 1,
        roomId: "Board1 Takeout Pause",
        expectedPlayerIndex: 0,
      });
      requestTakeoutReady("Board1 Takeout Pause");
      const next = applyCameraDart({
        kind: "triple",
        number: 19,
        roomId: "Board1 Takeout Pause",
        expectedPlayerIndex: 1,
      });
      expect(next.ok).toBe(true);
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board1 Takeout Pause");
    }
  });
});

describe("Board1 P0: dart 3 never jumps to next seat", () => {
  it("expectedPlayerIndex seat lock + hold refuse late dart 3 on the next seat", () => {
    const state = board1Match("Board1 Accept Seat");
    upsertServerMatch(state);
    clearTakeoutHold("Board1 Accept Seat");
    try {
      expect(
        applyCameraDart({
          kind: "triple",
          number: 20,
          roomId: "Board1 Accept Seat",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board1 Accept Seat",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      expect(
        applyCameraEndTurn({
          roomId: "Board1 Accept Seat",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);

      const lateThird = applyCameraDart({
        kind: "double",
        number: 16,
        roomId: "Board1 Accept Seat",
        expectedPlayerIndex: 0,
      });
      expect(lateThird.ok).toBe(false);
      if (!lateThird.ok) {
        expect(lateThird.error).toMatch(/Seat mismatch|Takeout hold/i);
      }

      // Empty visit after end-turn: READY ack (hold kept) - not a seat jump
      const readyAck = applyCameraEndTurn({
        roomId: "Board1 Accept Seat",
        expectedPlayerIndex: 0,
      });
      expect(readyAck.ok).toBe(true);
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board1 Accept Seat");
    }
  });

  it("open visit requires expectedPlayerIndex", () => {
    const state = board1Match("Board1 Accept Seat");
    upsertServerMatch(state);
    clearTakeoutHold("Board1 Accept Seat");
    try {
      expect(
        applyCameraDart({
          kind: "triple",
          number: 20,
          roomId: "Board1 Accept Seat",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      const missing = applyCameraDart({
        kind: "single",
        number: 5,
        roomId: "Board1 Accept Seat",
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) {
        expect(missing.error).toMatch(/expectedPlayerIndex required/i);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board1 Accept Seat");
    }
  });

  it("camera-correct-bleed has no `let state` (prefer-const / Railway build)", () => {
    const src = readSrc("src/lib/camera-correct-bleed.test.ts");
    expect(src).not.toMatch(/\blet state\b/);
  });
});

describe("Board1 acceptance: Board1-FixMe recovery bat", () => {
  it("ships ASCII Fix Me bat + board-setup link", () => {
    const bat = readSrc("public/Board1-FixMe.bat");
    expect(bat).toContain("___NO3_BOARD1_FIXME_PS1___");
    expect(bat).toContain("C:\\No3Darts\\Board1");
    expect(bat).toContain("start-board.bat");
    expect(bat).toContain("takeout-ready");
    expect(bat).toContain("PHOTO THIS WINDOW");
    expect(bat).toContain("board-station\\config.yaml");
    expect(bat).toMatch(/Leave the bridge window open/i);
    for (let i = 0; i < bat.length; i++) {
      expect(bat.charCodeAt(i)).toBeLessThanOrEqual(127);
    }

    const page = readSrc("src/app/board-setup/page.tsx");
    expect(page).toContain("/Board1-FixMe.bat");
    expect(page).toMatch(/Something wrong\?/i);
    expect(page).toMatch(/Fix Me/i);
  });
});
