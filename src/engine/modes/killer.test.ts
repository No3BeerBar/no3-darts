import { describe, expect, it } from "vitest";
import { applyDart, createDart, createGame, endTurn, validateKillerNumbers } from "@/engine";
import { killerExtra, killerFocusNumber } from "./killer";

function start(opts?: { lives?: number; numbers?: [number, number] }) {
  const lives = opts?.lives ?? 3;
  const [n1, n2] = opts?.numbers ?? [20, 19];
  return createGame({
    modeConfig: {
      mode: "killer",
      config: {
        lives,
        playerNumbers: { p1: n1, p2: n2 },
        doublesOnly: true,
      },
    },
    players: [
      { id: "p1", name: "Alice", isGuest: true },
      { id: "p2", name: "Bob", isGuest: true },
    ],
    matchFormat: { legsToWin: 1, setsToWin: 1 },
  });
}

describe("validateKillerNumbers", () => {
  it("requires ≥2 players and unique 1–20", () => {
    expect(validateKillerNumbers([{ id: "a", name: "A" }], { a: 1 })).toMatch(/at least 2/);
    expect(
      validateKillerNumbers(
        [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
        { a: 1, b: 1 }
      )
    ).toMatch(/already taken/);
    expect(
      validateKillerNumbers(
        [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
        { a: 1 }
      )
    ).toMatch(/1–20/);
    expect(
      validateKillerNumbers(
        [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
        { a: 7, b: 14 }
      )
    ).toBeNull();
  });
});

describe("killer classic rules — arm / attack / self-hit / win", () => {
  it("starts unarmed with assigned numbers and default lives", () => {
    const state = start();
    expect(state.mode).toBe("killer");
    const a = killerExtra(state.playerStates[0]);
    const b = killerExtra(state.playerStates[1]);
    expect(a).toMatchObject({ killerNumber: 20, lives: 3, isKiller: false, eliminated: false });
    expect(b).toMatchObject({ killerNumber: 19, lives: 3, isKiller: false, eliminated: false });
    expect(killerFocusNumber(state)).toBe(20);
  });

  it("arms only on own double (singles/triples/bull ignored)", () => {
    let state = start();
    state = applyDart(state, createDart("single", 20)).state;
    expect(killerExtra(state.playerStates[0]).isKiller).toBe(false);
    state = applyDart(state, createDart("triple", 20)).state;
    expect(killerExtra(state.playerStates[0]).isKiller).toBe(false);
    const armed = applyDart(state, createDart("double", 20));
    expect(armed.callout).toBe("KILLER!");
    expect(killerExtra(armed.state.playerStates[0]).isKiller).toBe(true);
    expect(killerExtra(armed.state.playerStates[0]).lives).toBe(3);
  });

  it("as Killer, opponent double removes one life; singles do not", () => {
    let state = start({ lives: 3, numbers: [20, 19] });
    // Alice arms
    state = applyDart(state, createDart("double", 20)).state;
    expect(killerExtra(state.playerStates[0]).isKiller).toBe(true);
    // Hit Bob's single — no effect
    state = applyDart(state, createDart("single", 19)).state;
    expect(killerExtra(state.playerStates[1]).lives).toBe(3);
    // Hit Bob's double — life lost
    const hit = applyDart(state, createDart("double", 19));
    expect(hit.callout).toMatch(/life lost/i);
    expect(killerExtra(hit.state.playerStates[1]).lives).toBe(2);
    expect(killerExtra(hit.state.playerStates[1]).eliminated).toBe(false);
  });

  it("as Killer, own double is a self-hit (lose a life)", () => {
    let state = start();
    state = applyDart(state, createDart("double", 20)).state; // arm
    const self = applyDart(state, createDart("double", 20));
    expect(self.callout).toMatch(/SELF/i);
    expect(killerExtra(self.state.playerStates[0]).lives).toBe(2);
    expect(killerExtra(self.state.playerStates[0]).isKiller).toBe(true);
  });

  it("eliminates at 0 lives and awards last standing the match", () => {
    let state = start({ lives: 1, numbers: [20, 19] });
    // Alice arms
    state = applyDart(state, createDart("double", 20)).state;
    // Kill Bob with one double (1 life)
    const finish = applyDart(state, createDart("double", 19));
    expect(finish.state.status).toBe("match_won");
    expect(finish.state.winnerId).toBe("p1");
    expect(finish.callout).toMatch(/Alice WINS/i);
    expect(killerExtra(finish.state.playerStates[1]).eliminated).toBe(true);
    expect(killerExtra(finish.state.playerStates[1]).lives).toBe(0);
  });

  it("self-out at last life can hand the match to the opponent", () => {
    let state = start({ lives: 1, numbers: [20, 19] });
    state = applyDart(state, createDart("double", 20)).state; // arm on 1 life
    const finish = applyDart(state, createDart("double", 20)); // self-hit → out
    expect(finish.state.status).toBe("match_won");
    expect(finish.state.winnerId).toBe("p2");
    expect(killerExtra(finish.state.playerStates[0]).eliminated).toBe(true);
  });

  it("skips eliminated players on end turn / pass", () => {
    let state = start({ lives: 1, numbers: [20, 19] });
    // Alice arms then we need Bob eliminated without ending match — use 3 players
    state = createGame({
      modeConfig: {
        mode: "killer",
        config: {
          lives: 1,
          playerNumbers: { p1: 20, p2: 19, p3: 18 },
          doublesOnly: true,
        },
      },
      players: [
        { id: "p1", name: "Alice", isGuest: true },
        { id: "p2", name: "Bob", isGuest: true },
        { id: "p3", name: "Cara", isGuest: true },
      ],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
    state = applyDart(state, createDart("double", 20)).state; // Alice killer
    state = applyDart(state, createDart("double", 19)).state; // Bob out
    expect(killerExtra(state.playerStates[1]).eliminated).toBe(true);
    // Finish Alice's turn (1 dart left capacity) then ensure Bob is skipped
    state = applyDart(state, createDart("miss", 0)).state;
    // After 3 darts turn auto-ends → should be Cara (index 2), not Bob
    expect(state.currentPlayerIndex).toBe(2);
    expect(state.players[state.currentPlayerIndex].id).toBe("p3");

    // Empty pass from Cara should skip Bob when wrapping
    state = endTurn(state).state; // Cara pass → Alice
    expect(state.currentPlayerIndex).toBe(0);
    state = endTurn(state).state; // Alice pass → Cara (skip Bob)
    expect(state.currentPlayerIndex).toBe(2);
  });
});
