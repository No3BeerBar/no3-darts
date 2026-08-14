import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "@/engine";
import { isMatchWinnerHold, matchWinnerLabel } from "./match-winner";

function won(): GameState {
  const state = createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    players: [
      { id: "a", name: "Alice", isGuest: false },
      { id: "b", name: "Bob", isGuest: false },
    ],
    roomId: "Board 1",
  });
  return { ...state, status: "match_won", winnerId: "a" };
}

describe("match winner hold", () => {
  it("names the winner for match_won and not for a live game", () => {
    const state = won();
    expect(isMatchWinnerHold(state)).toBe(true);
    expect(matchWinnerLabel(state)).toBe("Alice");
    expect(isMatchWinnerHold({ ...state, status: "playing", winnerId: null })).toBe(
      false
    );
    expect(
      matchWinnerLabel({ ...state, status: "playing", winnerId: null })
    ).toBeNull();
  });

  it("TV shows an obvious WINNER hold on /tv", () => {
    const tv = readFileSync(
      join(__dirname, "../components/tv/TvDisplay.tsx"),
      "utf8"
    );
    expect(tv).toMatch(/tv-winner-hold/);
    expect(tv).toMatch(/matchWinnerLabel/);
    expect(tv).toMatch(/WINNER/);
    expect(tv).toMatch(/isMatchWinnerHold/);
    expect(tv).toMatch(/z-\[90\]/);
  });
});
