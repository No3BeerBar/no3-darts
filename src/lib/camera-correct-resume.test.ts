/**
 * Board 1: after Fix dart / Undo, scoring must resume.
 *
 * Silent takeout: Autodarts in yellow reset, No3 showed nothing, darts
 * did not score. After correct the iPad must have Reset takeout and/or
 * Next visit — never only End game on a live match.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDart,
  correctTurnDartAt,
  createDart,
  createGame,
  type GameState,
} from "@/engine";
import { fortyOneTarget } from "@/engine/modes/forty-one";
import {
  shouldShowTakeoutUi,
  isLiveTakeoutSignal,
} from "@/lib/camera-health";
import {
  applyCameraCorrect,
  applyCameraDart,
  applyCameraUndo,
  clearTakeoutHold,
  getCameraGateSnapshot,
  getCameraHealth,
  removeServerMatch,
  requestTakeoutReady,
  setCameraHealth,
  upsertServerMatch,
} from "@/lib/server-game-store";

const ROOT = join(__dirname, "../..");
const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

const ROOM = "Board1 Correct Resume";

function fortyOneMatch(roomId: string) {
  return createGame({
    modeConfig: { mode: "forty_one", config: {} },
    players: [alice, bob],
    matchFormat: { legsToWin: 1, setsToWin: 1 },
    roomId,
  });
}

function withDarts(state: GameState, ...darts: ReturnType<typeof createDart>[]) {
  return darts.reduce((s, d) => applyDart(s, d).state, state);
}

function skipToAnyDouble(state: GameState): GameState {
  let live = state;
  const miss = [
    createDart("miss", 0),
    createDart("miss", 0),
    createDart("miss", 0),
  ];
  for (let r = 0; r < 2; r++) {
    live = withDarts(live, ...miss);
    live = withDarts(live, ...miss);
  }
  expect(fortyOneTarget(live).type).toBe("any_double");
  return live;
}

function seedHealth(roomId: string, takeout: boolean) {
  setCameraHealth({
    roomId,
    ok: true,
    level: takeout ? "takeout" : "ok",
    message: takeout ? "Pull darts - takeout" : "Cameras healthy",
    reason: takeout ? "takeout" : "ok",
    takeout,
    connected: true,
    ts: Date.now(),
  });
}

afterEach(() => {
  clearTakeoutHold(ROOM);
  seedHealth(ROOM, false);
});

describe("shouldShowTakeoutUi", () => {
  it("hides banner with no health / offline / stale leftover", () => {
    expect(shouldShowTakeoutUi(null)).toBe(false);
    expect(
      shouldShowTakeoutUi({
        roomId: ROOM,
        ok: false,
        level: "unhealthy",
        message: "offline",
        reason: "board_manager_offline",
        takeout: true,
        holdUntilTakeoutClear: true,
        connected: false,
        ts: Date.now(),
      })
    ).toBe(false);
  });

  it("shows Reset when server hold is set even if takeout:false (silent hold)", () => {
    expect(
      shouldShowTakeoutUi({
        roomId: ROOM,
        ok: true,
        level: "ok",
        message: "Cameras healthy",
        takeout: false,
        holdUntilTakeoutClear: true,
        connected: true,
        ts: Date.now(),
      })
    ).toBe(true);
    expect(isLiveTakeoutSignal({
      roomId: ROOM,
      ok: true,
      level: "ok",
      message: "Cameras healthy",
      takeout: false,
      holdUntilTakeoutClear: true,
      connected: true,
      ts: Date.now(),
    })).toBe(false);
  });
});

describe("correct then resume (41 any-double + D20)", () => {
  it("2-of-3 correct keeps the visit open so dart 3 can score", () => {
    let state = skipToAnyDouble(fortyOneMatch(ROOM));
    state = withDarts(
      state,
      createDart("double", 16),
      createDart("double", 20)
    );
    expect(state.currentTurnDarts).toHaveLength(2);
    upsertServerMatch(state);
    clearTakeoutHold(ROOM);
    seedHealth(ROOM, false);
    try {
      const corrected = applyCameraCorrect({
        roomId: ROOM,
        expectedPlayerIndex: 0,
        darts: [
          { kind: "double", number: 16 },
          { kind: "double", number: 8 },
        ],
        reason: "fix_d20",
      });
      expect(corrected.ok).toBe(true);
      if (!corrected.ok) throw new Error(corrected.error);
      expect(corrected.turnEnded).toBe(false);
      expect(corrected.state.status).toBe("playing");
      expect(corrected.state.currentTurnDarts).toHaveLength(2);
      expect(corrected.state.currentPlayerIndex).toBe(0);
      expect(getCameraGateSnapshot(ROOM).holdUntilTakeoutClear).toBe(false);

      const third = applyCameraDart({
        kind: "double",
        number: 4,
        roomId: ROOM,
        expectedPlayerIndex: 0,
      });
      expect(third.ok).toBe(true);
      if (!third.ok) throw new Error(third.error);
      expect(third.turnEnded).toBe(true);
      expect(third.state.currentPlayerIndex).toBe(1);
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("3-dart tablet Fix dart auto-ends and arms hold so Reset is visible", () => {
    let state = skipToAnyDouble(fortyOneMatch(ROOM));
    state = withDarts(
      state,
      createDart("double", 16),
      createDart("double", 20)
    );
    // Patron taps empty slot 3 (missing dart) — must not sit on Turn full
    const result = correctTurnDartAt(
      state,
      2,
      createDart("miss", 0, { source: "manual" })
    );
    expect(result.state.status).toBe("playing");
    expect(result.state.currentTurnDarts).toHaveLength(0);
    expect(result.state.currentPlayerIndex).toBe(1);

    upsertServerMatch(state);
    seedHealth(ROOM, false);
    try {
      upsertServerMatch(result.state);
      expect(getCameraGateSnapshot(ROOM).holdUntilTakeoutClear).toBe(true);
      const health = getCameraHealth(ROOM);
      expect(health?.holdUntilTakeoutClear).toBe(true);
      expect(shouldShowTakeoutUi(health)).toBe(true);

      requestTakeoutReady(ROOM);
      expect(getCameraGateSnapshot(ROOM).holdUntilTakeoutClear).toBe(false);
      const next = applyCameraDart({
        kind: "miss",
        number: 0,
        roomId: ROOM,
        expectedPlayerIndex: 1,
      });
      expect(next.ok).toBe(true);
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("undo after correct-close clears silent hold so camera can score again", () => {
    const state = fortyOneMatch(ROOM);
    upsertServerMatch(state);
    clearTakeoutHold(ROOM);
    seedHealth(ROOM, false);
    try {
      expect(
        applyCameraDart({
          kind: "single",
          number: 20,
          roomId: ROOM,
          expectedPlayerIndex: 0,
        }).ok
      ).toBe(true);
      const closed = applyCameraCorrect({
        roomId: ROOM,
        expectedPlayerIndex: 0,
        darts: [
          { kind: "triple", number: 20 },
          { kind: "miss", number: 0 },
          { kind: "miss", number: 0 },
        ],
        reason: "autodarts_state_diff",
      });
      expect(closed.ok).toBe(true);
      if (!closed.ok) throw new Error(closed.error);
      expect(closed.turnEnded).toBe(true);
      expect(getCameraGateSnapshot(ROOM).holdUntilTakeoutClear).toBe(true);
      // Companion posted takeout:false (yellow reset not mapped) — hold still shows
      seedHealth(ROOM, false);
      // Re-stamp hold after ok health (ok heartbeat must not clear a just-closed visit
      // unless reason is takeout_cleared — seedHealth uses reason "ok")
      expect(getCameraGateSnapshot(ROOM).holdUntilTakeoutClear).toBe(true);
      expect(shouldShowTakeoutUi(getCameraHealth(ROOM))).toBe(true);

      const undone = applyCameraUndo({ roomId: ROOM });
      expect(undone.ok).toBe(true);
      if (!undone.ok) throw new Error(undone.error);
      expect(undone.state.currentTurnDarts.length).toBeGreaterThan(0);
      expect(getCameraGateSnapshot(ROOM).holdUntilTakeoutClear).toBe(false);

      const again = applyCameraDart({
        kind: "single",
        number: 20,
        roomId: ROOM,
        expectedPlayerIndex: 0,
      });
      expect(again.ok).toBe(true);
    } finally {
      removeServerMatch(state.id);
    }
  });

  it("mid-visit correct while AD takeout is live clears silent hold and keeps scoring", () => {
    let state = skipToAnyDouble(fortyOneMatch(`${ROOM} TO`));
    state = withDarts(state, createDart("double", 20));
    upsertServerMatch(state);
    seedHealth(`${ROOM} TO`, true);
    try {
      expect(getCameraGateSnapshot(`${ROOM} TO`).holdUntilTakeoutClear).toBe(
        true
      );
      const corrected = applyCameraCorrect({
        roomId: `${ROOM} TO`,
        expectedPlayerIndex: 0,
        darts: [{ kind: "double", number: 16 }],
        reason: "fix",
      });
      expect(corrected.ok).toBe(true);
      if (!corrected.ok) throw new Error(corrected.error);
      expect(corrected.state.currentTurnDarts).toHaveLength(1);
      // Undo/correct must not leave the next-seat hold latched on an open visit
      expect(getCameraGateSnapshot(`${ROOM} TO`).holdUntilTakeoutClear).toBe(
        false
      );
      const second = applyCameraDart({
        kind: "double",
        number: 8,
        roomId: `${ROOM} TO`,
        expectedPlayerIndex: 0,
      });
      expect(second.ok).toBe(true);
    } finally {
      removeServerMatch(state.id);
      clearTakeoutHold(`${ROOM} TO`);
    }
  });
});

describe("play UI continue path after correct", () => {
  it("ScoringScreen exposes Next visit for patrons (not only End game)", () => {
    const screen = readFileSync(
      join(ROOT, "src/components/scoring/ScoringScreen.tsx"),
      "utf8"
    );
    expect(screen).toMatch(/Next visit/);
    expect(screen).toMatch(/onClick=\{endTurn\}/);
    expect(screen).toMatch(/TakeoutBanner/);
    expect(screen).toMatch(/Reset takeout|acknowledgeTakeout/);
  });
});
