import { describe, expect, it } from "vitest";
import { createGame } from "@/engine";
import { MATCH_WON_AUTOSAVE_MS, shouldAutoSaveMatch } from "./match-autosave";
import { MATCH_RESULT_HOLD_MS } from "./tv-match-feed";

describe("match autosave", () => {
  it("triggers only on match_won", () => {
    const base = createGame({
      modeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: true },
      },
      players: [{ id: "p1", name: "A", isGuest: false }],
    });
    expect(shouldAutoSaveMatch(null)).toBe(false);
    expect(shouldAutoSaveMatch(base)).toBe(false);
    expect(shouldAutoSaveMatch({ ...base, status: "leg_won" })).toBe(false);
    expect(shouldAutoSaveMatch({ ...base, status: "match_won" })).toBe(true);
    expect(shouldAutoSaveMatch({ ...base, status: "finished" })).toBe(false);
    expect(MATCH_WON_AUTOSAVE_MS).toBe(MATCH_RESULT_HOLD_MS);
    expect(MATCH_WON_AUTOSAVE_MS).toBe(30_000);
  });
});
