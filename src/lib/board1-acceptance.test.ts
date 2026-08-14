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
  getCameraGateSnapshot,
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
  it("TakeoutBanner exposes Reset takeout control (not a passive-only banner)", () => {
    const banner = readSrc("src/components/scoring/TakeoutBanner.tsx");
    expect(banner).toMatch(/Removing darts/);
    expect(banner).toMatch(/"Reset takeout"/);
    expect(banner).toMatch(/onReady/);
    expect(banner).toMatch(/stuck takeout/i);
    const screen = readSrc("src/components/scoring/ScoringScreen.tsx");
    expect(screen).toMatch(/TakeoutBanner/);
    expect(screen).toMatch(/acknowledgeTakeout/);
    // Reset must stay reachable even during PIN gate / bot turns
    expect(screen).toMatch(
      /useCameraHealth\(state\?\.roomId,\s*Boolean\(state\)\)/
    );
    const hook = readSrc("src/hooks/useCameraHealth.ts");
    expect(hook).toMatch(/takeout-ready/);
    expect(hook).toMatch(/acknowledgeTakeout/);
    expect(hook).toMatch(/shouldShowTakeoutUi/);
    expect(hook).toMatch(/isLiveTakeoutSignal/);
    expect(hook).not.toMatch(/Optimistic clear/);
  });

  it("TV shows prominent takeout / Reset status gated on live AD signal", () => {
    const tvBanner = readSrc("src/components/tv/TvTakeoutBanner.tsx");
    expect(tvBanner).toMatch(/Removing darts/);
    expect(tvBanner).toMatch(/Reset/);
    expect(tvBanner).toMatch(/scoring tablet/);
    expect(tvBanner).toMatch(/last visit/);
    expect(tvBanner).not.toMatch(/fixed inset-0/);
    const tv = readSrc("src/components/tv/TvDisplay.tsx");
    expect(tv).toMatch(/TvTakeoutBanner/);
    expect(tv).toMatch(/takeoutActive/);
    expect(tv).toMatch(/takeoutVisitDisplay/);
    const feed = readSrc("src/hooks/useTvMatchFeed.ts");
    expect(feed).toMatch(/isLiveTakeoutSignal/);
    expect(feed).toMatch(/shouldShowTakeoutUi/);
    expect(feed).toMatch(/takeoutActive/);
  });

  it("companion keep-alive starts a stopped board without reset/recal", () => {
    const ka = readSrc("tools/autodarts-companion/companion/keepalive.py");
    expect(ka).toMatch(/\/api\/detection\/start/);
    expect(ka).toMatch(/board_id/);
    expect(ka).toMatch(/is_board_stopped/);
    expect(ka).not.toMatch(/\/api\/reset/);
    expect(ka).not.toMatch(/try_recalibrate/);
    const client = readSrc("tools/autodarts-companion/companion/client.py");
    expect(client).toMatch(/def try_start_detection/);
    expect(client).toMatch(/\/api\/detection\/start/);
    expect(client).toMatch(/\/api\/start/);
    const health = readSrc("tools/autodarts-companion/companion/health.py");
    expect(health).toMatch(/board_stopped/);
    expect(health).toMatch(/is_board_stopped/);
    const bridge = readSrc("tools/autodarts-companion/companion/bridge.py");
    expect(bridge).toMatch(/maybe_keep_alive/);
    expect(bridge).toMatch(/ensure_board_detecting/);
    expect(bridge).toMatch(/after Board Manager restart/);
    expect(bridge).toMatch(/Idle-timer \/ leftover Stop/);
    const start = readSrc("tools/board-station/Start-Board.ps1");
    expect(start).toMatch(/function Ensure-BoardDetecting/);
    expect(start).toMatch(/start_board_if_stopped/);
    expect(start).toMatch(/Board detecting \(status=/);
    expect(start).toMatch(/-Method PUT/);
    expect(start).toMatch(/\/api\/detection\/start/);
  });

  it("recent visits name the thrower on iPad and TV", () => {
    const hist = readSrc("src/components/scoring/VisitHistory.tsx");
    expect(hist).toMatch(/visitThrowerName/);
    expect(hist).toMatch(/visitThrowerLabel/);
    expect(hist).toMatch(/recent-visit-thrower/);
    expect(hist).toMatch(/recent-visit-dart/);
    expect(hist).toMatch(/\{thrower\}/);
    const screen = readSrc("src/components/scoring/ScoringScreen.tsx");
    expect(screen).toMatch(/VisitHistory/);
    const tv = readSrc("src/components/tv/TvDisplay.tsx");
    expect(tv).toMatch(/VisitHistory/);
  });

  it("takeout UI keeps last visit visible; iPad Reset + stay-put board stay isolated", () => {
    const screen = readSrc("src/components/scoring/ScoringScreen.tsx");
    expect(screen).toMatch(/takeoutVisitDisplay/);
    expect(screen).toMatch(/holdingLastVisit/);
    expect(screen).toMatch(/play-board-stage/);
    expect(screen).toMatch(/play-board-fill/);
    expect(screen).toMatch(/playBoardSide/);
    expect(screen).not.toMatch(/tv-board-stage/);
    expect(screen).not.toMatch(/tvBoardSide/);
    const banner = readSrc("src/components/scoring/TakeoutBanner.tsx");
    expect(banner).toMatch(/"Reset takeout"/);
    expect(banner).toMatch(/bg-amber-950/);
    expect(banner).toMatch(/play-takeout-last-visit/);
    expect(banner).toMatch(/last visit/);
    const tv = readSrc("src/components/tv/TvDisplay.tsx");
    expect(tv).toMatch(/tv-board-stage/);
    expect(tv).toMatch(/tvBoardSide/);
    expect(tv).not.toMatch(/0\.58,\s*720/);
  });

  it("bridge maybe_end_turn fail-closed without expectedPlayerIndex", () => {
    const bridge = readSrc("tools/autodarts-companion/companion/bridge.py");
    expect(bridge).toMatch(/No3 seat unknown \(fail closed/);
    expect(bridge).toMatch(/"expectedPlayerIndex": seat/);
    expect(bridge).not.toMatch(
      /if seat is not None:\s*\n\s*payload\["expectedPlayerIndex"\]/
    );
    expect(bridge).toMatch(/keeping banner cleared until unlock/);
  });

  it("adversarial poll-replay sandbox covers John's five races", () => {
    const adv = readSrc(
      "tools/autodarts-companion/tests/test_visit_poll_adversarial.py"
    );
    expect(adv).toMatch(/takeout_blip/);
    expect(adv).toMatch(/late_dart3/);
    expect(adv).toMatch(/empty_flicker/);
    expect(adv).toMatch(/takeout_finished_at_2/);
    expect(adv).toMatch(/double_clear/);
    const fuzz = readSrc(
      "tools/autodarts-companion/tests/test_visit_poll_fuzzer.py"
    );
    expect(fuzz).toMatch(/takeout_finished_at_2/);
    expect(fuzz).toMatch(/double_clear/);
    expect(fuzz).toMatch(/test_adversarial_sandbox_patterns_always_pass/);
  });

  it("ResumeAuthGate pulls /api/matches/active before re-enabling scoring", () => {
    const gate = readSrc("src/components/scoring/ResumeAuthGate.tsx");
    expect(gate).toMatch(/\/api\/matches\/active/);
    expect(gate).toMatch(/localOnly:\s*true/);
    expect(gate).toMatch(/markSeatVerified/);
  });

  it("fresh /play document entry clears sticky session + seat trust (John signed-in repro)", () => {
    const entry = readSrc("src/lib/play-entry-gate.ts");
    expect(entry).toMatch(/gatePlayDocumentEntry/);
    expect(entry).toMatch(/clearPlayEntrySessionCookie/);
    expect(entry).toMatch(/invalidateSeatAuthOnPageRestore/);
    expect(entry).toMatch(/clearTabletSessionPlayers/);

    const scoring = readSrc("src/components/scoring/ScoringScreen.tsx");
    expect(scoring).toMatch(/hydrateSession\(\{\s*playEntry:\s*true\s*\}\)/);

    const setup = readSrc("src/components/setup/GameSetup.tsx");
    expect(setup).toMatch(/hydrateSession\(\{\s*playEntry:\s*true\s*\}\)/);

    const session = readSrc("src/store/session-store.ts");
    expect(session).toMatch(/opts\?\.playEntry/);
    expect(session).toMatch(/gatePlayDocumentEntry/);
    expect(session).toMatch(/player:\s*null/);
  });

  it("idle logout arms off-match and after match_won; never mid-match (John rules)", () => {
    const idle = readSrc("src/lib/play-session-idle.ts");
    expect(idle).toMatch(/isMidMatchForSessionIdle/);
    expect(idle).toMatch(/PLAY_SESSION_IDLE_MS\s*=\s*2\s*\*\s*60\s*\*\s*1000/);
    // Mid-match statuses that must NOT arm
    expect(idle).toMatch(/status === "playing"/);
    expect(idle).toMatch(/status === "paused"/);
    expect(idle).toMatch(/status === "leg_won"/);
    // match_won must not be treated as mid-match (timer re-arms after match ends)
    expect(idle).not.toMatch(/status === "match_won"/);

    const shell = readSrc("src/components/layout/AppShell.tsx");
    expect(shell).toMatch(/usePlaySessionIdleLogout/);
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

  it("takeout hold requires expectedPlayerIndex (old companion fail-closed)", () => {
    const state = board1Match("Board1 Accept SeatLock");
    upsertServerMatch(state);
    clearTakeoutHold("Board1 Accept SeatLock");
    try {
      applyCameraDart({
        kind: "single",
        number: 20,
        roomId: "Board1 Accept SeatLock",
        expectedPlayerIndex: 0,
      });
      applyCameraDart({
        kind: "single",
        number: 5,
        roomId: "Board1 Accept SeatLock",
        expectedPlayerIndex: 0,
      });
      applyCameraDart({
        kind: "single",
        number: 1,
        roomId: "Board1 Accept SeatLock",
        expectedPlayerIndex: 0,
      });
      expect(
        getCameraGateSnapshot("Board1 Accept SeatLock").holdUntilTakeoutClear
      ).toBe(true);

      const missingDart = applyCameraDart({
        kind: "triple",
        number: 19,
        roomId: "Board1 Accept SeatLock",
      });
      expect(missingDart.ok).toBe(false);
      if (!missingDart.ok) {
        expect(missingDart.error).toMatch(/expectedPlayerIndex required/i);
      }

      const missingEnd = applyCameraEndTurn({
        roomId: "Board1 Accept SeatLock",
      });
      expect(missingEnd.ok).toBe(false);
      if (!missingEnd.ok) {
        expect(missingEnd.error).toMatch(/expectedPlayerIndex required/i);
      }
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board1 Accept SeatLock");
    }
  });

  it("takeout health arms server hold (not companion-only freeze)", () => {
    const state = board1Match("Board1 Accept HealthHold");
    upsertServerMatch(state);
    clearTakeoutHold("Board1 Accept HealthHold");
    try {
      setCameraHealth({
        roomId: "Board1 Accept HealthHold",
        ok: true,
        level: "takeout",
        message: "Pull darts - takeout",
        reason: "takeout",
        takeout: true,
        ts: Date.now(),
      });
      expect(
        getCameraGateSnapshot("Board1 Accept HealthHold").holdUntilTakeoutClear
      ).toBe(true);

      const blocked = applyCameraDart({
        kind: "triple",
        number: 20,
        roomId: "Board1 Accept HealthHold",
        expectedPlayerIndex: 0,
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.error).toMatch(/Takeout (active|hold)/i);
      }

      requestTakeoutReady("Board1 Accept HealthHold");
      expect(
        getCameraGateSnapshot("Board1 Accept HealthHold").holdUntilTakeoutClear
      ).toBe(false);
      expect(
        applyCameraDart({
          kind: "triple",
          number: 20,
          roomId: "Board1 Accept HealthHold",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board1 Accept HealthHold");
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
    expect(bat).toMatch(/TV kiosk/i);
    expect(bat).toMatch(/No3-Board1-\(Setup\|FixMe\)/);
    // Always refresh kit so stale companion (no expectedPlayerIndex) is replaced
    expect(bat).toContain("Refreshing kit from production (always)");
    expect(bat).toContain("expectedPlayerIndex");
    expect(bat).toContain("Test-CompanionVenvHealthy");
    expect(bat).toContain("python.exe itself will not run");
    expect(bat).toContain("autodarts-companion\\.venv");
    for (let i = 0; i < bat.length; i++) {
      expect(bat.charCodeAt(i)).toBeLessThanOrEqual(127);
    }

    const page = readSrc("src/app/board-setup/page.tsx");
    expect(page).toContain("/Board1-FixMe.bat");
    expect(page).toMatch(/Something wrong\?/i);
    expect(page).toMatch(/Fix Me/i);
    expect(page).toMatch(/always refreshes the kit/i);
  });
});

describe("Board1 acceptance: play room label + start helper + no Σ banner", () => {
  it("keeps room sticky and surfaces Board label; start helper when empty", () => {
    const sync = readSrc("src/components/layout/RoomQuerySync.tsx");
    expect(sync).toContain("router.replace(playHref(stored))");
    expect(sync).toContain("router.replace(setupHref(stored))");

    const scoring = readSrc("src/components/scoring/ScoringScreen.tsx");
    expect(scoring).toContain("settings.roomName");
    expect(scoring).toContain("state.roomId || settings.roomName");
    // John: no per-dart Σ banner — X01 path keeps showDartPoints off
    expect(scoring).toMatch(/showDartPoints=\{baseball \|\| fortyOne\}/);
    expect(scoring).not.toMatch(/showDartPoints=\{true\}/);

    const setup = readSrc("src/components/setup/GameSetup.tsx");
    expect(setup).toMatch(/Add at least one player to start/);
    expect(setup).toContain("disabled={!canStart}");
  });
});

describe("Board1 acceptance: camera multi-step undo", () => {
  it("applyCameraUndo walks a full visit and fails closed when idle", async () => {
    const { applyCameraUndo } = await import("@/lib/server-game-store");
    const state = board1Match("Board1 Accept Undo");
    upsertServerMatch(state);
    clearTakeoutHold("Board1 Accept Undo");
    try {
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId: "Board1 Accept Undo",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 5,
          roomId: "Board1 Accept Undo",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      expect(
        applyCameraDart({
          kind: "single",
          number: 1,
          roomId: "Board1 Accept Undo",
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      requestTakeoutReady("Board1 Accept Undo");

      const u1 = applyCameraUndo({ roomId: "Board1 Accept Undo" });
      expect(u1.ok).toBe(true);
      if (u1.ok) {
        expect(u1.state.currentPlayerIndex).toBe(0);
        expect(u1.state.currentTurnDarts).toHaveLength(2);
      }
      expect(applyCameraUndo({ roomId: "Board1 Accept Undo" }).ok).toBe(true);
      expect(applyCameraUndo({ roomId: "Board1 Accept Undo" }).ok).toBe(true);
      const idle = applyCameraUndo({ roomId: "Board1 Accept Undo" });
      expect(idle.ok).toBe(false);
      if (!idle.ok) expect(idle.error).toMatch(/Nothing to undo/i);
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold("Board1 Accept Undo");
    }
  });
});
