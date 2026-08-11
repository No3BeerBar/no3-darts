import { describe, expect, it } from "vitest";
import { applyDart, createDart, createGame } from "@/engine";
import { generateBotVisit, generateNextBotDart } from "./generate-visit";
import type { Rng } from "./aim";

/** Deterministic RNG from a fixed sequence (cycles). */
function seqRng(values: number[]): Rng {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i += 1;
    return v;
  };
}

function startX01(botDifficulty: "rookie" | "luke_littler" = "luke_littler") {
  return createGame({
    modeConfig: { mode: "x01", config: { startScore: 501, doubleIn: false, doubleOut: true } },
    players: [
      {
        id: "bot1",
        name: botDifficulty === "luke_littler" ? "Luke Littler" : "Rookie",
        isGuest: true,
        isBot: true,
        botDifficulty,
      },
      { id: "human", name: "Patron", isGuest: true },
    ],
    matchFormat: { legsToWin: 1, setsToWin: 1 },
  });
}

describe("generateNextBotDart / generateBotVisit — X01", () => {
  it("emits bot-sourced darts and ends a visit in ≤3 darts", () => {
    const state = startX01("luke_littler");
    const visit = generateBotVisit(state, "luke_littler", seqRng([0.01, 0.01, 0.01, 0.01]));
    expect(visit.length).toBeGreaterThanOrEqual(1);
    expect(visit.length).toBeLessThanOrEqual(3);
    for (const d of visit) {
      expect(d.source).toBe("bot");
    }
  });

  it("Luke Littler hits intended T20 more often than Rookie (seeded)", () => {
    // Low rolls favor aim hits in resolveAim
    const hitty = seqRng([0.05, 0.05, 0.05, 0.05, 0.05, 0.05]);
    let lukeHits = 0;
    let rookieHits = 0;
    const trials = 40;
    for (let t = 0; t < trials; t++) {
      const luke = generateNextBotDart(startX01("luke_littler"), "luke_littler", hitty);
      const rook = generateNextBotDart(startX01("rookie"), "rookie", hitty);
      if (luke?.kind === "triple" && luke.number === 20) lukeHits += 1;
      if (rook?.kind === "triple" && rook.number === 20) rookieHits += 1;
    }
    expect(lukeHits).toBeGreaterThan(rookieHits);
  });

  it("attempts a checkout route when remaining is finishable", () => {
    let state = startX01("luke_littler");
    // Force remaining to 40 (D20) for the bot
    const ps = state.playerStates.find((p) => p.playerId === "bot1")!;
    ps.score = 40;
    // Always hit checkout
    const dart = generateNextBotDart(state, "luke_littler", seqRng([0.0, 0.0, 0.0]));
    expect(dart).not.toBeNull();
    expect(dart!.kind).toBe("double");
    expect(dart!.number).toBe(20);

    state = applyDart(state, dart!).state;
    expect(state.status === "leg_won" || state.status === "match_won").toBe(true);
  });

  it("does not wait for camera — bot darts apply through the engine like manual", () => {
    let state = createGame({
      modeConfig: { mode: "x01", config: { startScore: 301, doubleIn: false, doubleOut: true } },
      players: [
        {
          id: "bot1",
          name: "Pro",
          isGuest: true,
          isBot: true,
          botDifficulty: "pro",
        },
        { id: "human", name: "Patron", isGuest: true },
      ],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
    const before = state.playerStates[0]!.dartsThrown;
    const dart = generateNextBotDart(state, "pro", seqRng([0.2, 0.2, 0.2]));
    expect(dart).not.toBeNull();
    state = applyDart(state, dart!).state;
    expect(state.playerStates[0]!.dartsThrown).toBe(before + 1);
    // Human turn only after visit completes — first dart stays on bot
    expect(state.currentPlayerIndex === 0 || state.currentTurnDarts.length === 0).toBe(true);
  });
});

describe("generateBotVisit — Cricket", () => {
  it("aims at cricket numbers and marks progress", () => {
    let state = createGame({
      modeConfig: { mode: "cricket", config: { variant: "standard" } },
      players: [
        {
          id: "bot1",
          name: "League Night",
          isGuest: true,
          isBot: true,
          botDifficulty: "league",
        },
        { id: "human", name: "Patron", isGuest: true },
      ],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
    const visit = generateBotVisit(state, "league", seqRng([0.05, 0.05, 0.05, 0.05]));
    expect(visit.length).toBeGreaterThanOrEqual(1);
    for (const d of visit) {
      state = applyDart(state, d).state;
    }
    // Bot threw — either still throwing or advanced; marks or score may move
    const bot = state.playerStates.find((p) => p.playerId === "bot1")!;
    expect(bot.dartsThrown).toBeGreaterThan(0);
  });
});

describe("bot dart source tag", () => {
  it("createDart accepts source bot", () => {
    const d = createDart("triple", 20, { source: "bot" });
    expect(d.source).toBe("bot");
    expect(d.value).toBe(60);
  });
});
