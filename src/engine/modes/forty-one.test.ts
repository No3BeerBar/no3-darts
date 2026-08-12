import { describe, expect, it } from "vitest";
import { applyDart, createGame, createDart } from "@/engine";
import {
  FORTY_ONE_SEQUENCE,
  FORTY_ONE_START_SCORE,
  fortyOneDartPoints,
  fortyOneExact41DartContributes,
  fortyOneExact41VisitOk,
  fortyOneHalve,
  fortyOneRoundNumber,
  fortyOneTarget,
  fortyOneVisitResult,
} from "./forty-one";

describe("fortyOneHalve — ceil(score/2)", () => {
  it("rounds up on odd scores", () => {
    expect(fortyOneHalve(61)).toBe(31);
    expect(fortyOneHalve(60)).toBe(30);
    expect(fortyOneHalve(1)).toBe(1);
    expect(fortyOneHalve(0)).toBe(0);
    expect(fortyOneHalve(99)).toBe(50);
  });
});

describe("FORTY_ONE_SEQUENCE — John’s order", () => {
  it("is 20, 19, any double, 18, 17, any triple, 16, 15, exact 41, bull", () => {
    expect(FORTY_ONE_SEQUENCE).toEqual([
      { type: "number", n: 20 },
      { type: "number", n: 19 },
      { type: "any_double" },
      { type: "number", n: 18 },
      { type: "number", n: 17 },
      { type: "any_triple" },
      { type: "number", n: 16 },
      { type: "number", n: 15 },
      { type: "exact_41" },
      { type: "bull" },
    ]);
  });
});

describe("fortyOneDartPoints — each round type", () => {
  it("number round: only S/D/T of that number", () => {
    const t20 = { type: "number" as const, n: 20 };
    expect(fortyOneDartPoints(createDart("single", 20), t20)).toBe(20);
    expect(fortyOneDartPoints(createDart("double", 20), t20)).toBe(40);
    expect(fortyOneDartPoints(createDart("triple", 20), t20)).toBe(60);
    expect(fortyOneDartPoints(createDart("single", 19), t20)).toBe(0);
    expect(fortyOneDartPoints(createDart("miss", 0), t20)).toBe(0);
    expect(fortyOneDartPoints(createDart("bull", 50), t20)).toBe(0);
  });

  it("any double: D1–D20 and inner bull (50)", () => {
    const t = { type: "any_double" as const };
    expect(fortyOneDartPoints(createDart("double", 1), t)).toBe(2);
    expect(fortyOneDartPoints(createDart("double", 20), t)).toBe(40);
    expect(fortyOneDartPoints(createDart("bull", 50), t)).toBe(50);
    expect(fortyOneDartPoints(createDart("outer_bull", 25), t)).toBe(0);
    expect(fortyOneDartPoints(createDart("single", 20), t)).toBe(0);
    expect(fortyOneDartPoints(createDart("triple", 20), t)).toBe(0);
  });

  it("any triple: T1–T20 only", () => {
    const t = { type: "any_triple" as const };
    expect(fortyOneDartPoints(createDart("triple", 1), t)).toBe(3);
    expect(fortyOneDartPoints(createDart("triple", 20), t)).toBe(60);
    expect(fortyOneDartPoints(createDart("double", 20), t)).toBe(0);
    expect(fortyOneDartPoints(createDart("single", 20), t)).toBe(0);
    expect(fortyOneDartPoints(createDart("bull", 50), t)).toBe(0);
  });

  it("exact_41: every dart face value counts toward the sum", () => {
    const t = { type: "exact_41" as const };
    expect(fortyOneDartPoints(createDart("single", 20), t)).toBe(20);
    expect(fortyOneDartPoints(createDart("triple", 7), t)).toBe(21);
    expect(fortyOneDartPoints(createDart("miss", 0), t)).toBe(0);
    expect(fortyOneDartPoints(createDart("outer_bull", 25), t)).toBe(25);
  });

  it("bull: outer 25 / inner 50 only", () => {
    const t = { type: "bull" as const };
    expect(fortyOneDartPoints(createDart("outer_bull", 25), t)).toBe(25);
    expect(fortyOneDartPoints(createDart("bull", 50), t)).toBe(50);
    expect(fortyOneDartPoints(createDart("single", 20), t)).toBe(0);
    expect(fortyOneDartPoints(createDart("double", 20), t)).toBe(0);
  });
});

describe("fortyOneVisitResult", () => {
  it("normal round: adds valid points when at least one hit", () => {
    const t = { type: "number" as const, n: 18 };
    const r = fortyOneVisitResult(
      [createDart("single", 18), createDart("double", 18), createDart("single", 6)],
      t
    );
    expect(r).toEqual({ kind: "scored", points: 54 });
  });

  it("normal round: complete miss → halved", () => {
    const t = { type: "number" as const, n: 18 };
    expect(
      fortyOneVisitResult(
        [createDart("single", 6), createDart("miss", 0), createDart("triple", 20)],
        t
      )
    ).toEqual({ kind: "halved" });
  });

  it("exact_41 success → +41 only", () => {
    const t = { type: "exact_41" as const };
    // 20 + 20 + 1 = 41
    const r = fortyOneVisitResult(
      [createDart("single", 20), createDart("single", 20), createDart("single", 1)],
      t
    );
    expect(r).toEqual({ kind: "scored", points: 41 });
  });

  it("exact_41 T7 + S20 + MISS → halved (not +41)", () => {
    const t = { type: "exact_41" as const };
    // Live bug: 21 + 20 + 0 = 41 if MISS counts as 0 — must HALVE
    const darts = [
      createDart("triple", 7),
      createDart("single", 20),
      createDart("miss", 0),
    ];
    expect(darts[2].kind).toBe("miss");
    expect(darts[2].value).toBe(0);
    expect(darts.reduce((a, d) => a + d.value, 0)).toBe(41);
    expect(fortyOneExact41DartContributes(darts[2])).toBe(false);
    expect(fortyOneExact41VisitOk(darts)).toBe(false);
    expect(fortyOneVisitResult(darts, t)).toEqual({ kind: "halved" });
    expect(fortyOneVisitResult(darts, t)).not.toEqual({ kind: "scored", points: 41 });
  });

  it("exact_41 wrong sum → halved", () => {
    const t = { type: "exact_41" as const };
    expect(
      fortyOneVisitResult(
        [createDart("single", 20), createDart("single", 20), createDart("single", 5)],
        t
      )
    ).toEqual({ kind: "halved" });
  });

  it("exact_41 with fewer than 3 darts → halved", () => {
    const t = { type: "exact_41" as const };
    expect(
      fortyOneVisitResult([createDart("single", 20), createDart("single", 20)], t)
    ).toEqual({ kind: "halved" });
  });
});

describe("forty_one engine play", () => {
  function start() {
    return createGame({
      modeConfig: { mode: "forty_one", config: {} },
      players: [
        { id: "p1", name: "Alice", isGuest: true },
        { id: "p2", name: "Bob", isGuest: true },
      ],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
  }

  function throwThree(
    state: ReturnType<typeof start>,
    a: Parameters<typeof createDart>,
    b: Parameters<typeof createDart>,
    c: Parameters<typeof createDart>
  ) {
    let s = state;
    s = applyDart(s, createDart(...a)).state;
    if (s.currentTurnDarts.length > 0) s = applyDart(s, createDart(...b)).state;
    if (s.currentTurnDarts.length > 0) s = applyDart(s, createDart(...c)).state;
    return s;
  }

  it("starts at 60 on round 20", () => {
    const state = start();
    expect(state.mode).toBe("forty_one");
    expect(state.playerStates[0].score).toBe(FORTY_ONE_START_SCORE);
    expect(state.playerStates[1].score).toBe(FORTY_ONE_START_SCORE);
    expect(fortyOneRoundNumber(state)).toBe(1);
    expect(fortyOneTarget(state)).toEqual({ type: "number", n: 20 });
  });

  it("adds valid hits; partial miss does not halve", () => {
    let state = start();
    state = throwThree(
      state,
      ["single", 20],
      ["single", 1],
      ["double", 20]
    );
    // Alice: +20 +0 +40 = +60 → 120; Bob to throw
    expect(state.playerStates[0].score).toBe(120);
    expect(state.playerStates[0].extra?.lastVisitHalved).toBe(false);
    expect(state.playerStates[0].extra?.lastVisitPoints).toBe(60);
    expect(state.currentPlayerIndex).toBe(1);
  });

  it("complete miss halves with ceil", () => {
    let state = start();
    // First visit Alice misses → 30
    state = throwThree(state, ["miss", 0], ["miss", 0], ["single", 1]);
    expect(state.playerStates[0].score).toBe(30);
    expect(state.playerStates[0].extra?.lastVisitHalved).toBe(true);

    // Bob scores T20 → +60 → 120
    state = throwThree(state, ["triple", 20], ["miss", 0], ["miss", 0]);
    expect(state.playerStates[1].score).toBe(120);

    // Round advances to 19 after Bob (both played round 20)
    expect(fortyOneTarget(state)).toEqual({ type: "number", n: 19 });

    // Engine: Alice on 19s — miss from 30 → 15
    state = throwThree(state, ["miss", 0], ["miss", 0], ["miss", 0]);
    expect(state.playerStates[0].score).toBe(15);
  });

  it("any-double round counts doubles and inner bull", () => {
    let state = start();
    // Skip to any_double (round index 2): both players miss rounds 20 and 19
    for (let r = 0; r < 2; r++) {
      for (let p = 0; p < 2; p++) {
        state = throwThree(state, ["miss", 0], ["miss", 0], ["miss", 0]);
      }
    }
    expect(fortyOneTarget(state).type).toBe("any_double");
    // Alice was halved twice from 60 → 30 → 15
    expect(state.playerStates[0].score).toBe(15);

    state = throwThree(
      state,
      ["double", 10],
      ["bull", 50],
      ["single", 5]
    );
    // +20 +50 +0 = +70 → 85
    expect(state.playerStates[0].score).toBe(85);
  });

  it("exact-41 success adds 41; failure halves", () => {
    let state = start();
    // Advance to exact_41 (index 8): 8 rounds × 2 players of misses
    for (let r = 0; r < 8; r++) {
      for (let p = 0; p < 2; p++) {
        if (state.status !== "playing") break;
        state = throwThree(state, ["miss", 0], ["miss", 0], ["miss", 0]);
      }
    }
    expect(fortyOneTarget(state).type).toBe("exact_41");
    const before = state.playerStates[0].score;

    // Success: 20+16+5 = 41
    state = throwThree(
      state,
      ["single", 20],
      ["single", 16],
      ["single", 5]
    );
    expect(state.playerStates[0].score).toBe(before + 41);
    expect(state.playerStates[0].extra?.lastVisitPoints).toBe(41);

    // Bob fails: 20+20+20 = 60
    const bobBefore = state.playerStates[1].score;
    state = throwThree(
      state,
      ["single", 20],
      ["single", 20],
      ["single", 20]
    );
    expect(state.playerStates[1].score).toBe(fortyOneHalve(bobBefore));
    expect(state.playerStates[1].extra?.lastVisitHalved).toBe(true);
  });

  it("exact-41 engine: T7 + S20 + MISS halves (not +41)", () => {
    let state = start();
    for (let r = 0; r < 8; r++) {
      for (let p = 0; p < 2; p++) {
        if (state.status !== "playing") break;
        state = throwThree(state, ["miss", 0], ["miss", 0], ["miss", 0]);
      }
    }
    expect(fortyOneTarget(state).type).toBe("exact_41");
    const before = state.playerStates[0].score;

    state = throwThree(state, ["triple", 7], ["single", 20], ["miss", 0]);
    expect(state.playerStates[0].score).toBe(fortyOneHalve(before));
    expect(state.playerStates[0].extra?.lastVisitHalved).toBe(true);
    expect(state.turns[state.turns.length - 1]?.bust).toBe(true);
  });

  it("plays all rounds; highest score wins", () => {
    let state = start();
    // Alice always hits something useful; Bob always misses
    for (let r = 0; r < FORTY_ONE_SEQUENCE.length; r++) {
      expect(state.status).toBe("playing");
      const t = fortyOneTarget(state);
      if (t.type === "exact_41") {
        state = throwThree(
          state,
          ["single", 20],
          ["single", 20],
          ["single", 1]
        );
      } else if (t.type === "number") {
        state = throwThree(
          state,
          ["triple", t.n],
          ["miss", 0],
          ["miss", 0]
        );
      } else if (t.type === "any_double") {
        state = throwThree(
          state,
          ["double", 20],
          ["miss", 0],
          ["miss", 0]
        );
      } else if (t.type === "any_triple") {
        state = throwThree(
          state,
          ["triple", 20],
          ["miss", 0],
          ["miss", 0]
        );
      } else {
        state = throwThree(
          state,
          ["bull", 50],
          ["miss", 0],
          ["miss", 0]
        );
      }
      // Bob misses
      if (state.status === "playing") {
        state = throwThree(state, ["miss", 0], ["miss", 0], ["miss", 0]);
      }
    }
    expect(state.status === "leg_won" || state.status === "match_won").toBe(true);
    expect(state.playerStates[0].score).toBeGreaterThan(state.playerStates[1].score);
    expect(state.legWinnerId ?? state.winnerId).toBe("p1");
  });

  it("2-player 41 keeps scoring and advancing after round 3 (any double)", () => {
    // Bar freeze: after the third round, P2's darts stopped applying and the
    // visit never advanced. Round 3 is ANY DOUBLE — both seats throw the same
    // target. Engine must still wrap to round 4 (18s) and keep taking visits.
    let state = start();
    expect(state.status).toBe("playing");

    function missVisit(s: typeof state) {
      return throwThree(s, ["miss", 0], ["miss", 0], ["miss", 0]);
    }

    // Rounds 1–2: 20s then 19s (both players)
    for (let r = 0; r < 2; r++) {
      expect(state.status).toBe("playing");
      const thrower = state.currentPlayerIndex;
      state = missVisit(state);
      expect(state.currentPlayerIndex).toBe(1 - thrower);
      expect(state.currentTurnDarts).toHaveLength(0);
      state = missVisit(state);
      expect(state.currentPlayerIndex).toBe(thrower);
    }
    expect(fortyOneTarget(state).type).toBe("any_double");
    expect(fortyOneRoundNumber(state)).toBe(3);
    expect(state.currentPlayerIndex).toBe(0);

    // Round 3: Alice hits doubles; Bob misses — must still advance
    state = throwThree(
      state,
      ["double", 20],
      ["double", 16],
      ["double", 8]
    );
    expect(state.status).toBe("playing");
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.currentTurnDarts).toHaveLength(0);
    expect(state.playerStates[0].extra?.lastVisitHalved).toBe(false);

    state = missVisit(state);
    expect(state.status).toBe("playing");
    expect(state.currentPlayerIndex).toBe(0);
    expect(fortyOneTarget(state)).toEqual({ type: "number", n: 18 });
    expect(fortyOneRoundNumber(state)).toBe(4);

    // Round 4: both still score / wrap
    const bobBefore = state.playerStates[1].score;
    state = throwThree(state, ["triple", 18], ["miss", 0], ["miss", 0]);
    expect(state.currentPlayerIndex).toBe(1);
    state = missVisit(state);
    expect(state.currentPlayerIndex).toBe(0);
    expect(fortyOneTarget(state)).toEqual({ type: "number", n: 17 });
    expect(state.playerStates[1].score).toBe(fortyOneHalve(bobBefore));
    expect(state.status).toBe("playing");
  });
});
