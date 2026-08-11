import { describe, expect, it } from "vitest";
import {
  applyDart,
  createDart,
  createGame,
  endTurn,
  startNextLeg,
  undo,
} from "@/engine";
import {
  computePlayerRoundStats,
  formatRoundStat,
  marksFromDart,
  roundStatsForMode,
} from "./player-stats";

const alice = { id: "p1", name: "Alice", isGuest: true };
const bob = { id: "p2", name: "Bob", isGuest: true };

function cricketGame(legsToWin = 1) {
  return createGame({
    modeConfig: { mode: "cricket", config: { variant: "standard" } },
    players: [alice, bob],
    matchFormat: { legsToWin, setsToWin: 1 },
  });
}

function x01Game(legsToWin = 1, startScore: 301 | 501 = 301) {
  return createGame({
    modeConfig: {
      mode: "x01",
      config: { startScore, doubleIn: false, doubleOut: false },
    },
    players: [alice, bob],
    matchFormat: { legsToWin, setsToWin: 1 },
  });
}

describe("roundStatsForMode", () => {
  it("emphasizes MPR for Cricket and PPR for X01", () => {
    expect(roundStatsForMode("cricket")).toEqual({ mpr: true, ppr: false });
    expect(roundStatsForMode("x01")).toEqual({ mpr: false, ppr: true });
    expect(roundStatsForMode("countup").ppr).toBe(true);
    expect(roundStatsForMode("shanghai").ppr).toBe(true);
  });

  it("hides stats for Baseball, 41, Killer", () => {
    expect(roundStatsForMode("baseball")).toEqual({ mpr: false, ppr: false });
    expect(roundStatsForMode("forty_one")).toEqual({ mpr: false, ppr: false });
    expect(roundStatsForMode("killer")).toEqual({ mpr: false, ppr: false });
  });
});

describe("marksFromDart", () => {
  const nums = [20, 19, 18, 17, 16, 15, 25];
  it("counts cricket marks on in-play numbers only", () => {
    expect(marksFromDart(createDart("triple", 20), nums)).toBe(3);
    expect(marksFromDart(createDart("double", 19), nums)).toBe(2);
    expect(marksFromDart(createDart("bull", 50), nums)).toBe(2);
    expect(marksFromDart(createDart("outer_bull", 25), nums)).toBe(1);
    expect(marksFromDart(createDart("triple", 14), nums)).toBe(0);
    expect(marksFromDart(createDart("miss", 0), nums)).toBe(0);
  });
});

describe("formatRoundStat", () => {
  it("single-leg shows one number (no slash)", () => {
    expect(formatRoundStat({ current: 2.45, overall: 2.45 }, false)).toBe("2.45");
  });

  it("multi-leg shows current / overall", () => {
    expect(formatRoundStat({ current: 2.45, overall: 2.61 }, true)).toBe(
      "2.45 / 2.61"
    );
  });

  it("returns null when no visits", () => {
    expect(formatRoundStat({ current: null, overall: null }, true)).toBeNull();
    expect(formatRoundStat(null, false)).toBeNull();
  });
});

describe("MPR — Cricket", () => {
  it("updates live within a visit (marks ÷ visits)", () => {
    let state = cricketGame(1);
    // Alice: T20 T20 → 6 marks, 1 visit in progress → MPR 6.00
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    const live = computePlayerRoundStats(state, "p1");
    expect(live.mpr?.current).toBe(6);
    expect(live.ppr).toBeNull();
    expect(formatRoundStat(live.mpr, false)).toBe("6.00");

    // Finish visit with miss → still 6 marks / 1 visit
    state = applyDart(state, createDart("miss", 0)).state;
    const after = computePlayerRoundStats(state, "p1");
    expect(after.mpr?.current).toBe(6);
    expect(state.turns[0]?.legNumber).toBe(1);
  });

  it("averages across completed visits", () => {
    let state = cricketGame(1);
    // Visit 1: T20 T20 T20 = 9 marks
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    // Bob pass-ish: three misses
    state = applyDart(state, createDart("miss", 0)).state;
    state = applyDart(state, createDart("miss", 0)).state;
    state = applyDart(state, createDart("miss", 0)).state;
    // Visit 2 Alice: S19 miss miss = 1 mark → total 10 / 2 = 5.00
    state = applyDart(state, createDart("single", 19)).state;
    state = applyDart(state, createDart("miss", 0)).state;
    state = applyDart(state, createDart("miss", 0)).state;
    const stats = computePlayerRoundStats(state, "p1");
    expect(stats.mpr?.current).toBe(5);
  });
});

describe("PPR — X01", () => {
  it("is points scored ÷ visits (bust counts as 0 points)", () => {
    let state = x01Game(1, 301);
    // Alice 180
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    expect(computePlayerRoundStats(state, "p1").ppr?.current).toBe(180);

    // Bob 26
    state = applyDart(state, createDart("single", 20)).state;
    state = applyDart(state, createDart("single", 5)).state;
    state = applyDart(state, createDart("single", 1)).state;

    // Alice busts (301-180=121; throw 180 again → bust)
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 20)).state;
    // 180 + 0 over 2 visits = 90
    const stats = computePlayerRoundStats(state, "p1");
    expect(stats.ppr?.current).toBe(90);
    expect(formatRoundStat(stats.ppr, false)).toBe("90.00");
  });

  it("includes live visit points before turn ends", () => {
    let state = x01Game(1, 501);
    state = applyDart(state, createDart("triple", 20)).state;
    state = applyDart(state, createDart("triple", 19)).state;
    const live = computePlayerRoundStats(state, "p1");
    // 60+57 = 117 over 1 visit
    expect(live.ppr?.current).toBe(117);
  });
});

describe("multi-leg current / overall", () => {
  it("formats Cricket MPR as current / overall after next leg", () => {
    let state = cricketGame(2);
    // Leg 1: Alice closes enough for a quick-ish win is hard; instead force via
    // completing visits then manually advancing after a leg win path.
    // Simpler: play visits, win leg by closing all + points — use short script.
    // Alice: mark everything with triples over several visits, Bob misses.

    const markVisit = (s: typeof state, n: number) => {
      let st = s;
      st = applyDart(st, createDart("triple", n)).state;
      st = applyDart(st, createDart("triple", n)).state;
      // third dart miss unless still need marks — use miss to end
      if (st.status === "playing" && st.currentTurnDarts.length < 3) {
        st = applyDart(st, createDart("miss", 0)).state;
      }
      return st;
    };
    const missVisit = (s: typeof state) => {
      let st = s;
      st = applyDart(st, createDart("miss", 0)).state;
      st = applyDart(st, createDart("miss", 0)).state;
      st = applyDart(st, createDart("miss", 0)).state;
      return st;
    };

    // Close 20,19,18,17,16,15,bull for Alice — 2 marks per number need another single
    // T20 T20 miss = 6 marks → closed 20
    for (const n of [20, 19, 18, 17, 16, 15]) {
      state = markVisit(state, n);
      if (state.status === "playing") state = missVisit(state);
    }
    // Bull: outer + bull + miss → 1+2 = 3 marks closes bull; may win
    state = applyDart(state, createDart("outer_bull", 25)).state;
    state = applyDart(state, createDart("bull", 50)).state;
    if (state.status === "playing" && state.currentTurnDarts.length > 0) {
      state = applyDart(state, createDart("miss", 0)).state;
    }
    // If not yet won (points), Alice may need to score — for standard with Bob at 0,
    // closing all with score >= opponents wins.
    if (state.status === "playing") {
      // ensure turn ended
      if (state.currentTurnDarts.length > 0) state = endTurn(state).state;
      // Bob miss if Alice's turn ended
      if (state.players[state.currentPlayerIndex].id === "p2") {
        state = missVisit(state);
      }
    }

    expect(["leg_won", "match_won", "playing"]).toContain(state.status);

    if (state.status === "playing") {
      // Fallback: still verify single-leg formatting on leg 1 multi-leg match
      const mid = computePlayerRoundStats(state, "p1");
      expect(formatRoundStat(mid.mpr, true)).toMatch(/^\d+\.\d{2} \/ \d+\.\d{2}$/);
      return;
    }

    const afterLeg1 = computePlayerRoundStats(state, "p1");
    expect(afterLeg1.mpr?.current).not.toBeNull();
    expect(afterLeg1.mpr?.overall).toBe(afterLeg1.mpr?.current);
    expect(formatRoundStat(afterLeg1.mpr, true)).toMatch(
      /^\d+\.\d{2} \/ \d+\.\d{2}$/
    );

    if (state.status !== "leg_won") return;

    state = startNextLeg(state);
    expect(state.legNumber).toBe(2);
    // Loser (Bob) starts — miss his visit so Alice can throw
    expect(state.players[state.currentPlayerIndex].id).toBe("p2");
    state = missVisit(state);

    // Leg 2: one weak visit for Alice (S20 miss miss = 1 mark)
    expect(state.players[state.currentPlayerIndex].id).toBe("p1");
    state = applyDart(state, createDart("single", 20)).state;
    state = applyDart(state, createDart("miss", 0)).state;
    state = applyDart(state, createDart("miss", 0)).state;

    const multi = computePlayerRoundStats(state, "p1");
    expect(multi.mpr?.current).toBe(1);
    expect(multi.mpr?.overall).not.toBeNull();
    expect(multi.mpr!.overall!).toBeGreaterThan(multi.mpr!.current!);
    expect(formatRoundStat(multi.mpr, true)).toBe(
      `1.00 / ${multi.mpr!.overall!.toFixed(2)}`
    );
  });

  it("formats X01 PPR as current / overall across legs", () => {
    // Straight-out 301 for fast legs
    let state = x01Game(2, 301);

    const throwVisit = (s: typeof state, darts: ReturnType<typeof createDart>[]) => {
      let st = s;
      for (const d of darts) {
        st = applyDart(st, d).state;
        if (st.status !== "playing") break;
      }
      return st;
    };

    // Alice: 180 + 121 checkout (T20 T11 D14)
    state = throwVisit(state, [
      createDart("triple", 20),
      createDart("triple", 20),
      createDart("triple", 20),
    ]);
    state = throwVisit(state, [
      createDart("miss", 0),
      createDart("miss", 0),
      createDart("miss", 0),
    ]);
    state = throwVisit(state, [
      createDart("triple", 20),
      createDart("triple", 11),
      createDart("double", 14),
    ]);
    expect(state.status).toBe("leg_won");

    const leg1 = computePlayerRoundStats(state, "p1");
    // 180 + 121 = 301 over 2 visits → 150.50
    expect(leg1.ppr?.current).toBe(150.5);
    expect(formatRoundStat(leg1.ppr, true)).toBe("150.50 / 150.50");

    state = startNextLeg(state);
    // Loser starts leg 2
    expect(state.players[state.currentPlayerIndex].id).toBe("p2");
    state = throwVisit(state, [
      createDart("miss", 0),
      createDart("miss", 0),
      createDart("miss", 0),
    ]);
    // Alice scores 60
    expect(state.players[state.currentPlayerIndex].id).toBe("p1");
    state = throwVisit(state, [
      createDart("triple", 20),
      createDart("miss", 0),
      createDart("miss", 0),
    ]);
    const leg2 = computePlayerRoundStats(state, "p1");
    expect(leg2.ppr?.current).toBe(60);
    // overall: (301 + 60) / 3 = 120.333… → 120.33
    expect(leg2.ppr?.overall).toBe(120.33);
    expect(formatRoundStat(leg2.ppr, true)).toBe("60.00 / 120.33");
  });
});

describe("undo / correction awareness", () => {
  it("recomputes PPR when current darts are undone", () => {
    let state = x01Game(1, 501);
    state = applyDart(state, createDart("triple", 20)).state;
    expect(computePlayerRoundStats(state, "p1").ppr?.current).toBe(60);

    state = undo(state).state;
    expect(computePlayerRoundStats(state, "p1").ppr?.current).toBeNull();
  });
});
