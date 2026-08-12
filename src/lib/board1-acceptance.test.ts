/**
 * Board 1 / camera-bridge acceptance net (John bar QA).
 *
 * Focused regression guards for the P0s from Board 1 takeout / seat-jump /
 * resume / callout testing. Companion pytest covers takeout freeze +
 * between-games recal (tools/autodarts-companion/tests/test_board1_acceptance.py).
 *
 * These tests must FAIL if the invariants regress.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyDart,
  createDart,
  createGame,
  undo,
} from "@/engine";
import {
  applyCameraDart,
  applyCameraEndTurn,
  removeServerMatch,
  upsertServerMatch,
} from "@/lib/server-game-store";
import {
  canScoreMatch,
  clearSeatAuth,
  getSeatAuth,
  seedSeatAuthForMatch,
} from "@/lib/seat-auth";
import { getActiveGame, setActiveGame } from "@/lib/storage";

const ROOT = join(__dirname, "../..");

const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

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

function board1Match(roomId = "Board 1") {
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
  clearSeatAuth();
  memory.clear();
  vi.restoreAllMocks();
});

describe("Board1 acceptance: 3-dart visit seat lock", () => {
  it("late dart 3 with expectedPlayerIndex cannot apply to the next seat", () => {
    const state = board1Match("Board1 Accept Seat");
    upsertServerMatch(state);
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

      // Premature end-turn (what the bridge must never do before dart 3)
      expect(
        applyCameraEndTurn({ roomId: "Board1 Accept Seat" }).ok
      ).toBe(true);

      const lateThird = applyCameraDart({
        kind: "double",
        number: 16,
        roomId: "Board1 Accept Seat",
        expectedPlayerIndex: 0,
      });
      expect(lateThird.ok).toBe(false);
      if (!lateThird.ok) {
        expect(lateThird.error).toMatch(/Seat mismatch/i);
      }

      const badEnd = applyCameraEndTurn({
        roomId: "Board1 Accept Seat",
        expectedPlayerIndex: 0,
      });
      expect(badEnd.ok).toBe(false);
      if (!badEnd.ok) {
        expect(badEnd.error).toMatch(/Seat mismatch/i);
      }
    } finally {
      removeServerMatch(state.id);
    }
  });
});

describe("Board1 acceptance: patron multi undo", () => {
  it("steps backward dart-by-dart across a full visit", () => {
    const start = board1Match();
    const after3 = applyDart(
      applyDart(
        applyDart(start, createDart("single", 20)).state,
        createDart("single", 5)
      ).state,
      createDart("single", 1)
    ).state;
    expect(after3.currentPlayerIndex).toBe(1);

    const u1 = undo(after3).state;
    expect(u1.currentPlayerIndex).toBe(0);
    expect(u1.currentTurnDarts).toHaveLength(2);

    const u2 = undo(u1).state;
    expect(u2.currentTurnDarts).toHaveLength(1);

    const u3 = undo(u2).state;
    expect(u3.currentTurnDarts).toHaveLength(0);
  });

  it("ScoringScreen wires patron Undo (not staff-gated)", () => {
    const src = readSrc("src/components/scoring/ScoringScreen.tsx");
    expect(src).toMatch(/Undo \+ End game are patron-visible/);
    expect(src).toContain("onClick={undo}");
    // Undo enablement must not require isAdmin
    expect(src).toMatch(
      /const undoEnabled =\s*seatsOk &&\s*!botThrowing &&\s*canUndo\(state\)/
    );
    expect(src).not.toMatch(/undoEnabled\s*=\s*isAdmin/);
  });
});

describe("Board1 acceptance: no CalloutToast / per-dart Σ banner on play/TV", () => {
  it("CalloutToast component is not present or imported on play/TV", () => {
    expect(existsSync(join(ROOT, "src/components/scoring/CalloutToast.tsx"))).toBe(
      false
    );
    const play = readSrc("src/components/scoring/ScoringScreen.tsx");
    const tv = readSrc("src/components/tv/TvDisplay.tsx");
    const feed = readSrc("src/hooks/useTvMatchFeed.ts");
    expect(play).not.toMatch(/CalloutToast/);
    expect(play).not.toMatch(/lastCallout/);
    expect(tv).not.toMatch(/CalloutToast/);
    expect(tv).not.toMatch(/\bcallout\b/);
    expect(feed).not.toMatch(/\bcallout\b/);
  });

  it("visit total label is TURN, not the per-dart Σ banner glyph", () => {
    const turn = readSrc("src/components/scoring/TurnDarts.tsx");
    expect(turn).toContain(">TURN<");
    // Must not resurrect the distracting Σ visit-total label
    expect(turn).not.toMatch(/>Σ</);
  });
});

describe("Board1 acceptance: fresh hydrate invalidates seat auth", () => {
  it("hydrate of an active match clears verified seats (PIN required)", async () => {
    installMemoryStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    );

    const state = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: true },
      },
      players: [
        { id: "alice", name: "Alice", isGuest: false },
        { id: "bob", name: "Bob", isGuest: true },
      ],
      roomId: "Board 1",
    });
    setActiveGame(state);
    seedSeatAuthForMatch(state.id, state.players, "alice");
    expect(canScoreMatch(state.id, state.players, "alice")).toBe(true);

    const { useGameStore } = await import("@/store/game-store");
    useGameStore.setState({
      state: null,
      hydrated: false,
      displayOnly: false,
      lastCallout: null,
      lastHighlight: null,
    });

    useGameStore.getState().hydrate();

    expect(getActiveGame()?.id).toBe(state.id);
    expect(getSeatAuth()).toMatchObject({
      matchId: state.id,
      verifiedPlayerIds: [],
      boundSessionPlayerId: null,
    });
    expect(canScoreMatch(state.id, state.players, "alice")).toBe(false);
  });
});

describe("Board1 acceptance: camera-correct-bleed prefer-const", () => {
  it("has no `let state` (prefer-const / Railway next build)", () => {
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
