import { describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import {
  BOT_BETWEEN_DARTS_MS,
  BOT_TURN_START_DELAY_MS,
  planBotTurn,
} from "./turn";

function gameWithBotFirst() {
  return createGame({
    modeConfig: { mode: "x01", config: { startScore: 501, doubleIn: false, doubleOut: true } },
    players: [
      {
        id: "bot1",
        name: "Luke Littler",
        isGuest: true,
        isBot: true,
        botDifficulty: "luke_littler",
      },
      { id: "human", name: "Patron", isGuest: false },
    ],
    matchFormat: { legsToWin: 1, setsToWin: 1 },
  });
}

describe("planBotTurn — automation hooks", () => {
  it("schedules a delayed throw when the current seat is a bot", () => {
    const state = gameWithBotFirst();
    const plan = planBotTurn(state);
    expect(plan).toEqual({
      action: "throw",
      delayMs: BOT_TURN_START_DELAY_MS,
      playerId: "bot1",
    });
  });

  it("uses a shorter gap after the first dart of the visit", () => {
    const state = gameWithBotFirst();
    state.currentTurnDarts = [
      {
        id: "d1",
        kind: "triple",
        number: 20,
        value: 60,
        timestamp: Date.now(),
        source: "bot",
      },
    ];
    const plan = planBotTurn(state);
    expect(plan.action).toBe("throw");
    if (plan.action === "throw") {
      expect(plan.delayMs).toBe(BOT_BETWEEN_DARTS_MS);
    }
  });

  it("idles for human throwers", () => {
    const state = gameWithBotFirst();
    state.currentPlayerIndex = 1;
    expect(planBotTurn(state)).toEqual({ action: "idle" });
  });

  it("idles when match is aborted / not playing", () => {
    const state = gameWithBotFirst();
    state.status = "finished";
    expect(planBotTurn(state)).toEqual({ action: "idle" });
    expect(planBotTurn(null)).toEqual({ action: "idle" });
  });
});
