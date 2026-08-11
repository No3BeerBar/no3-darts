import { describe, expect, it } from "vitest";
import { applyDart, createDart, createGame, endTurn } from "@/engine";
import {
  getKillerExtra,
  killerBoardFocus,
  validateKillerNumbers,
} from "./killer";

function start(opts?: {
  lives?: number;
  numbers?: Record<string, number>;
  players?: Array<{ id: string; name: string }>;
}) {
  const players = opts?.players ?? [
    { id: "p1", name: "Alice" },
    { id: "p2", name: "Bob" },
  ];
  const numbers =
    opts?.numbers ??
    Object.fromEntries(players.map((p, i) => [p.id, i + 1]));
  return createGame({
    modeConfig: {
      mode: "killer",
      config: {
        lives: opts?.lives ?? 3,
        playerNumbers: numbers,
        doublesOnly: true,
      },
    },
    players: players.map((p) => ({ ...p, isGuest: true })),
    matchFormat: { legsToWin: 1, setsToWin: 1 },
  });
}

describe("validateKillerNumbers", () => {
  it("requires at least 2 players", () => {
    expect(validateKillerNumbers([{ id: "a", name: "A" }], { a: 1 })).toMatch(
      /at least 2/
    );
  });

  it("requires unique 1–20 numbers", () => {
    const players = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    expect(validateKillerNumbers(players, { a: 1, b: 1 })).toMatch(/taken/);
    expect(validateKillerNumbers(players, { a: 0, b: 2 })).toMatch(/1–20/);
    expect(validateKillerNumbers(players, { a: 1 })).toMatch(/B/);
    expect(validateKillerNumbers(players, { a: 7, b: 20 })).toBeNull();
  });
});

describe("killer engine play", () => {
  it("starts unarmed with configured lives and numbers", () => {
    const state = start({ lives: 5, numbers: { p1: 20, p2: 5 } });
    expect(state.mode).toBe("killer");
    const a = getKillerExtra(state.playerStates[0]);
    const b = getKillerExtra(state.playerStates[1]);
    expect(a).toMatchObject({ killerNumber: 20, lives: 5, isKiller: false, eliminated: false });
    expect(b).toMatchObject({ killerNumber: 5, lives: 5, isKiller: false });
    expect(state.playerStates[0].score).toBe(5);
  });

  it("arms on own double only", () => {
    let state = start({ numbers: { p1: 20, p2: 5 } });
    // Single / triple / bull of own number do nothing
    state = applyDart(state, createDart("single", 20)).state;
    expect(getKillerExtra(state.playerStates[0]).isKiller).toBe(false);
    state = applyDart(state, createDart("triple", 20)).state;
    expect(getKillerExtra(state.playerStates[0]).isKiller).toBe(false);
    const r = applyDart(state, createDart("double", 20));
    expect(r.callout).toBe("KILLER!");
    expect(getKillerExtra(r.state.playerStates[0]).isKiller).toBe(true);
  });

  it("ignores opponent doubles before armed", () => {
    let state = start({ numbers: { p1: 20, p2: 5 } });
    state = applyDart(state, createDart("double", 5)).state;
    expect(getKillerExtra(state.playerStates[1]).lives).toBe(3);
    expect(getKillerExtra(state.playerStates[0]).isKiller).toBe(false);
  });

  it("as Killer: opponent double removes a life", () => {
    let state = start({ numbers: { p1: 20, p2: 5 } });
    state = applyDart(state, createDart("double", 20)).state; // arm
    const r = applyDart(state, createDart("double", 5));
    expect(r.callout).toMatch(/life lost/i);
    expect(getKillerExtra(r.state.playerStates[1]).lives).toBe(2);
  });

  it("as Killer: own double is a self-hit", () => {
    let state = start({ numbers: { p1: 20, p2: 5 } });
    state = applyDart(state, createDart("double", 20)).state;
    const r = applyDart(state, createDart("double", 20));
    expect(r.callout).toMatch(/SELF/i);
    expect(getKillerExtra(r.state.playerStates[0]).lives).toBe(2);
    expect(getKillerExtra(r.state.playerStates[0]).isKiller).toBe(true);
  });

  it("eliminates at 0 lives and awards the last alive player", () => {
    let state = start({
      lives: 1,
      numbers: { p1: 20, p2: 5 },
    });
    state = applyDart(state, createDart("double", 20)).state; // arm
    const r = applyDart(state, createDart("double", 5));
    expect(r.callout).toMatch(/WINS/i);
    expect(r.state.status).toBe("match_won");
    expect(r.state.winnerId).toBe("p1");
    expect(getKillerExtra(r.state.playerStates[1]).eliminated).toBe(true);
  });

  it("self-out can end the match when only one remains", () => {
    let state = start({
      lives: 1,
      numbers: { p1: 20, p2: 5 },
    });
    // Alice arms then self-hits → out; Bob wins
    state = applyDart(state, createDart("double", 20)).state;
    const r = applyDart(state, createDart("double", 20));
    expect(r.callout).toMatch(/Bob WINS|WINS/i);
    expect(r.state.winnerId).toBe("p2");
  });

  it("skips eliminated players on endTurn", () => {
    let state = start({
      lives: 1,
      players: [
        { id: "p1", name: "Alice" },
        { id: "p2", name: "Bob" },
        { id: "p3", name: "Cara" },
      ],
      numbers: { p1: 20, p2: 5, p3: 10 },
    });
    // Alice arms + eliminates Bob
    state = applyDart(state, createDart("double", 20)).state;
    state = applyDart(state, createDart("double", 5)).state;
    expect(getKillerExtra(state.playerStates[1]).eliminated).toBe(true);
    // finish Alice visit if needed
    if (state.status === "playing" && state.currentPlayerIndex === 0) {
      state = endTurn(state).state;
    }
    // Next should be Cara (skip Bob)
    expect(state.currentPlayerIndex).toBe(2);
    expect(state.players[state.currentPlayerIndex].id).toBe("p3");
  });

  it("bull / miss never change lives", () => {
    let state = start({ numbers: { p1: 20, p2: 5 } });
    state = applyDart(state, createDart("double", 20)).state;
    state = applyDart(state, createDart("bull", 50)).state;
    state = applyDart(state, createDart("miss", 0)).state;
    expect(getKillerExtra(state.playerStates[0]).lives).toBe(3);
    expect(getKillerExtra(state.playerStates[1]).lives).toBe(3);
  });
});

describe("killerBoardFocus", () => {
  it("highlights own number; when armed, also opponent numbers", () => {
    let state = start({ numbers: { p1: 20, p2: 5 } });
    expect(killerBoardFocus(state)).toEqual({
      primary: 20,
      secondary: [],
      focusKind: "double",
    });
    state = applyDart(state, createDart("double", 20)).state;
    expect(killerBoardFocus(state)).toEqual({
      primary: 20,
      secondary: [5],
      focusKind: "double",
    });
  });
});
