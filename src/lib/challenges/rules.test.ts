import { describe, expect, it } from "vitest";
import type { GameState, Turn } from "@/engine/types";
import {
  evaluateChallengeGoals,
  isEligibleVisit,
  type ChallengeGoalDef,
} from "./rules";

function dart(
  kind: "single" | "double" | "triple" | "bull" | "outer_bull" | "miss",
  number: number,
  opts?: { edited?: boolean; source?: "manual" | "camera" | "bot" }
) {
  const value =
    kind === "bull"
      ? 50
      : kind === "outer_bull"
        ? 25
        : kind === "miss"
          ? 0
          : kind === "double"
            ? number * 2
            : kind === "triple"
              ? number * 3
              : number;
  return {
    id: `d_${kind}_${number}`,
    kind,
    number: kind === "bull" ? 50 : kind === "outer_bull" ? 25 : number,
    value,
    timestamp: 1,
    source: opts?.source ?? "camera",
    ...(opts?.edited ? { edited: true as const } : {}),
  };
}

function turn(
  playerId: string,
  darts: ReturnType<typeof dart>[],
  opts?: Partial<Turn>
): Turn {
  const total = darts.reduce((a, d) => a + d.value, 0);
  return {
    playerId,
    darts,
    startScore: 501,
    endScore: 501 - total,
    bust: false,
    checkout: false,
    timestamp: 1,
    ...opts,
  };
}

function state(partial: Partial<GameState> & { turns: Turn[] }): GameState {
  return {
    id: "m1",
    status: "match_won",
    mode: "x01",
    modeConfig: {
      mode: "x01",
      config: { startScore: 501, doubleIn: false, doubleOut: true },
    },
    matchFormat: { legsToWin: 1, setsToWin: 1 },
    players: [
      { id: "p1", name: "Alice", isGuest: false },
      { id: "p2", name: "Bob", isGuest: false },
    ],
    playerStates: [
      {
        playerId: "p1",
        score: 0,
        legsWon: 1,
        setsWon: 1,
        dartsThrown: 9,
        totalScore: 501,
        first9Total: 0,
        first9Darts: 0,
        checkoutAttempts: 1,
        checkoutsHit: 1,
        oneEighties: 0,
        highestCheckout: 80,
      },
    ],
    teams: [],
    throwOrder: [0, 1],
    currentPlayerIndex: 0,
    currentTurnDarts: [],
    legNumber: 1,
    setNumber: 1,
    roundIndex: 0,
    winnerId: "p1",
    legWinnerId: "p1",
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("challenge rules — uncorrected semantics", () => {
  it("edited visit does not credit; clean camera visit does", () => {
    const goals: ChallengeGoalDef[] = [
      {
        id: "g_180",
        ruleType: "one_eighty",
        params: {},
        points: 10,
        stack: "every",
      },
      {
        id: "g_bull",
        ruleType: "bull",
        params: {},
        points: 1,
        stack: "every",
      },
    ];

    const clean180 = turn("p1", [
      dart("triple", 20),
      dart("triple", 20),
      dart("triple", 20),
    ]);
    const edited180 = turn(
      "p1",
      [dart("triple", 20), dart("triple", 20), dart("triple", 20)],
      { edited: true }
    );
    const cleanBull = turn("p1", [dart("bull", 50), dart("single", 1), dart("miss", 0)]);

    expect(isEligibleVisit(clean180)).toBe(true);
    expect(isEligibleVisit(edited180)).toBe(false);

    const credits = evaluateChallengeGoals(
      state({ turns: [edited180, clean180, cleanBull] }),
      "p1",
      goals
    );
    expect(credits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ goalId: "g_180", points: 10, occurrences: 1 }),
        expect.objectContaining({ goalId: "g_bull", points: 1, occurrences: 1 }),
      ])
    );
    // Edited 180 must not add a second occurrence
    expect(credits.find((c) => c.goalId === "g_180")?.occurrences).toBe(1);
  });

  it("skips bot-sourced visits", () => {
    const goals: ChallengeGoalDef[] = [
      { id: "g", ruleType: "one_eighty", params: {}, points: 5, stack: "every" },
    ];
    const botTurn = turn("p1", [
      dart("triple", 20, { source: "bot" }),
      dart("triple", 20, { source: "bot" }),
      dart("triple", 20, { source: "bot" }),
    ]);
    const credits = evaluateChallengeGoals(state({ turns: [botTurn] }), "p1", goals);
    expect(credits).toEqual([]);
  });
});

describe("challenge rule types", () => {
  it("bull with count threshold + stack once/every", () => {
    const turns = [
      turn("p1", [dart("bull", 50), dart("bull", 50), dart("outer_bull", 25)]),
      turn("p1", [dart("bull", 50), dart("single", 1), dart("miss", 0)]),
    ];
    // 3 inner bulls
    const once: ChallengeGoalDef = {
      id: "b3",
      ruleType: "bull",
      params: { count: 3 },
      points: 15,
      stack: "once",
    };
    const every: ChallengeGoalDef = {
      id: "b2",
      ruleType: "bull",
      params: { count: 2 },
      points: 5,
      stack: "every",
    };
    const withOuter: ChallengeGoalDef = {
      id: "bo",
      ruleType: "bull",
      params: { includeOuter: true },
      points: 1,
      stack: "every",
    };
    const credits = evaluateChallengeGoals(state({ turns }), "p1", [once, every, withOuter]);
    expect(credits.find((c) => c.goalId === "b3")).toMatchObject({ points: 15, occurrences: 1 });
    expect(credits.find((c) => c.goalId === "b2")).toMatchObject({ points: 5, occurrences: 1 }); // floor(3/2)=1
    expect(credits.find((c) => c.goalId === "bo")?.occurrences).toBe(4); // 3 inner + 1 outer
  });

  it("checkout_min awards double-out 80+", () => {
    const goals: ChallengeGoalDef[] = [
      {
        id: "co",
        ruleType: "checkout_min",
        params: { min: 80, requireDoubleOut: true },
        points: 20,
        stack: "every",
      },
    ];
    const ok = turn(
      "p1",
      [dart("triple", 20), dart("double", 10)],
      { checkout: true, startScore: 80, endScore: 0 }
    );
    const low = turn(
      "p1",
      [dart("double", 16)],
      { checkout: true, startScore: 32, endScore: 0 }
    );
    const notDouble = turn(
      "p1",
      [dart("triple", 20), dart("single", 20)],
      { checkout: true, startScore: 80, endScore: 0 }
    );
    const credits = evaluateChallengeGoals(
      state({ turns: [ok, low, notDouble] }),
      "p1",
      goals
    );
    expect(credits).toEqual([
      expect.objectContaining({ goalId: "co", points: 20, occurrences: 1 }),
    ]);
  });

  it("visit_score and segment_hit", () => {
    const goals: ChallengeGoalDef[] = [
      {
        id: "vs",
        ruleType: "visit_score",
        params: { min: 100 },
        points: 3,
        stack: "every",
      },
      {
        id: "t20",
        ruleType: "segment_hit",
        params: { kind: "triple", number: 20 },
        points: 1,
        stack: "every",
      },
    ];
    const turns = [
      turn("p1", [dart("triple", 20), dart("triple", 20), dart("single", 1)]), // 121
      turn("p1", [dart("single", 20), dart("single", 5), dart("single", 1)]), // 26
    ];
    const credits = evaluateChallengeGoals(state({ turns }), "p1", goals);
    expect(credits.find((c) => c.goalId === "vs")).toMatchObject({ points: 3, occurrences: 1 });
    expect(credits.find((c) => c.goalId === "t20")).toMatchObject({ points: 2, occurrences: 2 });
  });

  it("match_win and legs_won", () => {
    const goals: ChallengeGoalDef[] = [
      { id: "mw", ruleType: "match_win", params: {}, points: 50, stack: "once" },
      { id: "lw", ruleType: "legs_won", params: {}, points: 5, stack: "every" },
    ];
    const s = state({
      turns: [],
      winnerId: "p1",
      playerStates: [
        {
          playerId: "p1",
          score: 0,
          legsWon: 2,
          setsWon: 1,
          dartsThrown: 0,
          totalScore: 0,
          first9Total: 0,
          first9Darts: 0,
          checkoutAttempts: 0,
          checkoutsHit: 0,
          oneEighties: 0,
          highestCheckout: 0,
        },
      ],
    });
    const credits = evaluateChallengeGoals(s, "p1", goals);
    expect(credits.find((c) => c.goalId === "mw")).toMatchObject({ points: 50 });
    expect(credits.find((c) => c.goalId === "lw")).toMatchObject({ points: 10, occurrences: 2 });

    const loser = evaluateChallengeGoals({ ...s, winnerId: "p2" }, "p1", goals);
    expect(loser.find((c) => c.goalId === "mw")).toBeUndefined();
  });
});
