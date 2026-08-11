import { describe, expect, it } from "vitest";
import { applyDart, createDart, createGame } from "@/engine";
import { FORTY_ONE_SEQUENCE } from "../modes/forty-one";
import { resolveAim, type Rng } from "./aim";
import {
  aimExactFaceValue,
  generateBotVisit,
  generateNextBotDart,
  planFortyOneAim,
  planFortyOneAimForTarget,
} from "./generate-visit";
import { BOT_PROFILES, getBotProfile } from "./profiles";

/** Deterministic RNG from a fixed sequence (cycles). */
function seqRng(values: number[]): Rng {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i += 1;
    return v;
  };
}

function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

function startFortyOne(botDifficulty: "luke_littler" | "pub" = "luke_littler") {
  return createGame({
    modeConfig: { mode: "forty_one", config: {} },
    players: [
      {
        id: "bot1",
        name: botDifficulty === "luke_littler" ? "Luke Littler" : "Pub Regular",
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
    const ps = state.playerStates.find((p) => p.playerId === "bot1")!;
    ps.score = 40;
    const dart = generateNextBotDart(state, "luke_littler", seqRng([0.0, 0.0, 0.0]));
    expect(dart).not.toBeNull();
    expect(dart!.kind).toBe("double");
    expect(dart!.number).toBe(20);

    state = applyDart(state, dart!).state;
    expect(state.status === "leg_won" || state.status === "match_won").toBe(true);
  });

  it("uses classic 141 route (T20 T19 D12) for Luke", () => {
    const state = startX01("luke_littler");
    const ps = state.playerStates.find((p) => p.playerId === "bot1")!;
    ps.score = 141;
    // Low rolls → hit intended aim
    const d1 = generateNextBotDart(state, "luke_littler", seqRng([0.0, 0.0, 0.0]));
    expect(d1?.kind).toBe("triple");
    expect(d1?.number).toBe(20);
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
    expect(state.currentPlayerIndex === 0 || state.currentTurnDarts.length === 0).toBe(true);
  });
});

describe("Luke Littler X01 scoring profile — smoke", () => {
  it("simulated T20-lane scoring visits land in a high-average band (~95–110)", () => {
    const profile = getBotProfile("luke_littler");
    const rng = mulberry32(20260811);
    const visits = 800;
    let total = 0;
    for (let v = 0; v < visits; v++) {
      let visitSum = 0;
      for (let d = 0; d < 3; d++) {
        const aim =
          rng() < profile.trebleBias
            ? ({ kind: "triple", number: 20 } as const)
            : rng() < 0.15
              ? ({ kind: "triple", number: 19 } as const)
              : ({ kind: "single", number: 20 } as const);
        visitSum += resolveAim(aim, profile, rng).value;
      }
      total += visitSum;
    }
    const avg = total / visits;
    expect(avg).toBeGreaterThanOrEqual(95);
    expect(avg).toBeLessThanOrEqual(110);
    // Profile label should sit near the real-world ~100–103 band
    expect(profile.scoringAvg).toBeGreaterThanOrEqual(100);
    expect(profile.scoringAvg).toBeLessThanOrEqual(103);
    expect(profile.checkoutSkill).toBeGreaterThanOrEqual(0.4);
    expect(profile.checkoutSkill).toBeLessThanOrEqual(0.5);
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
    const bot = state.playerStates.find((p) => p.playerId === "bot1")!;
    expect(bot.dartsThrown).toBeGreaterThan(0);
  });
});

describe("41 bot aim — mode-aware (not X01 T20 spam)", () => {
  const luke = BOT_PROFILES.luke_littler;

  it("aims at the current number round (19), not T20", () => {
    const aims = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const aim = planFortyOneAimForTarget(
        { type: "number", n: 19 },
        [],
        luke,
        seqRng([0.1 + i * 0.01, 0.2, 0.3])
      );
      expect(aim.kind === "single" || aim.kind === "triple" || aim.kind === "double").toBe(true);
      if (aim.kind === "single" || aim.kind === "triple" || aim.kind === "double") {
        expect(aim.number).toBe(19);
        aims.add(aim.number);
      }
    }
    expect(aims.has(19)).toBe(true);
    expect(aims.has(20)).toBe(false);
  });

  it("any_double aims a double (not T20)", () => {
    for (let i = 0; i < 20; i++) {
      const aim = planFortyOneAimForTarget(
        { type: "any_double" },
        [],
        luke,
        seqRng([i / 20, 0.5, 0.5])
      );
      expect(aim.kind).toBe("double");
    }
  });

  it("any_triple aims a triple segment (sensible numbers)", () => {
    for (let i = 0; i < 20; i++) {
      const aim = planFortyOneAimForTarget(
        { type: "any_triple" },
        [],
        luke,
        seqRng([i / 20, 0.5, 0.5])
      );
      expect(aim.kind).toBe("triple");
      if (aim.kind === "triple") {
        expect(aim.number).toBeGreaterThanOrEqual(16);
        expect(aim.number).toBeLessThanOrEqual(20);
      }
    }
  });

  it("exact_41 opener is never three-T20 spam (planned aim ≠ T20-only)", () => {
    const openers: string[] = [];
    for (let i = 0; i < 40; i++) {
      const aim = planFortyOneAimForTarget(
        { type: "exact_41" },
        [],
        luke,
        seqRng([i / 40, 0.1, 0.2])
      );
      openers.push(
        aim.kind === "bull" || aim.kind === "outer_bull" || aim.kind === "miss"
          ? aim.kind
          : `${aim.kind[0]!.toUpperCase()}${aim.number}`
      );
    }
    // Must include non-T20 plans across the opener set
    const onlyT20 = openers.every((o) => o === "T20");
    expect(onlyT20).toBe(false);
    // And T20 single/triple is at most an occasional opener, not exclusive
    const t20Share = openers.filter((o) => o === "T20").length / openers.length;
    expect(t20Share).toBeLessThan(0.5);
  });

  it("exact_41 last dart aims the exact remaining face value", () => {
    const darts = [createDart("triple", 13), createDart("single", 1)]; // 39+1=40, need 1
    const aim = planFortyOneAimForTarget({ type: "exact_41" }, darts, luke, seqRng([0, 0, 0]));
    expect(aim).toEqual({ kind: "single", number: 1 });
  });

  it("exact_41 mid-visit adapts after a scored opener", () => {
    const darts = [createDart("triple", 7)]; // 21, leave 20 with 2 darts
    const aim = planFortyOneAimForTarget({ type: "exact_41" }, darts, luke, seqRng([0.0, 0.0, 0.0]));
    // Should chase a setup toward remaining 20 — never blindly T20 as "scoring"
    expect(aim.kind).not.toBe("miss");
    if (aim.kind === "triple" || aim.kind === "double" || aim.kind === "single") {
      const v =
        aim.kind === "triple" ? aim.number * 3 : aim.kind === "double" ? aim.number * 2 : aim.number;
      expect(v).toBeLessThan(20);
    }
  });

  it("bull round aims bull / outer bull", () => {
    const aim = planFortyOneAimForTarget({ type: "bull" }, [], luke, seqRng([0.1]));
    expect(aim.kind === "bull" || aim.kind === "outer_bull").toBe(true);
  });

  it("live Luke visit on round 19 does not exclusively throw segment 20", () => {
    let state = startFortyOne("luke_littler");
    state.roundIndex = 1; // 19
    expect(FORTY_ONE_SEQUENCE[state.roundIndex]).toEqual({ type: "number", n: 19 });

    const intended = planFortyOneAim(state, luke, seqRng([0.05, 0.05]));
    expect(intended.kind === "single" || intended.kind === "triple").toBe(true);
    if (intended.kind === "single" || intended.kind === "triple") {
      expect(intended.number).toBe(19);
    }

    // High-accuracy rolls: resolved darts should land on 19 far more than 20
    let on19 = 0;
    let on20 = 0;
    const trials = 50;
    for (let t = 0; t < trials; t++) {
      const dart = generateNextBotDart(state, "luke_littler", seqRng([0.02, 0.02, 0.02, t * 0.001]));
      if (dart && (dart.kind === "single" || dart.kind === "double" || dart.kind === "triple")) {
        if (dart.number === 19) on19 += 1;
        if (dart.number === 20) on20 += 1;
      }
    }
    expect(on19).toBeGreaterThan(on20);
    expect(on19).toBeGreaterThan(trials * 0.5);
  });

  it("exact_41 live darts are not exclusively T20", () => {
    let state = startFortyOne("luke_littler");
    state.roundIndex = FORTY_ONE_SEQUENCE.findIndex((t) => t.type === "exact_41");
    expect(state.roundIndex).toBeGreaterThanOrEqual(0);

    let t20Count = 0;
    let otherCount = 0;
    const trials = 60;
    for (let t = 0; t < trials; t++) {
      const aim = planFortyOneAim(state, luke, mulberry32(1000 + t));
      if (aim.kind === "triple" && aim.number === 20) t20Count += 1;
      else otherCount += 1;
    }
    expect(otherCount).toBeGreaterThan(t20Count);
    expect(t20Count / trials).toBeLessThan(0.35);
  });
});

describe("aimExactFaceValue", () => {
  it("maps common remainders", () => {
    expect(aimExactFaceValue(1)).toEqual({ kind: "single", number: 1 });
    expect(aimExactFaceValue(40)).toEqual({ kind: "double", number: 20 });
    expect(aimExactFaceValue(60)).toEqual({ kind: "triple", number: 20 });
    expect(aimExactFaceValue(50)).toEqual({ kind: "bull" });
    expect(aimExactFaceValue(25)).toEqual({ kind: "outer_bull" });
    expect(aimExactFaceValue(23)).toBeNull();
  });
});

describe("Baseball / Killer mode-aware aims", () => {
  it("baseball aims the inning number, not T20", () => {
    const state = createGame({
      modeConfig: { mode: "baseball", config: { innings: 9 } },
      players: [
        {
          id: "bot1",
          name: "Luke Littler",
          isGuest: true,
          isBot: true,
          botDifficulty: "luke_littler",
        },
        { id: "human", name: "Patron", isGuest: true },
      ],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
    state.roundIndex = 3; // inning 4
    let on4 = 0;
    let on20 = 0;
    for (let t = 0; t < 40; t++) {
      const dart = generateNextBotDart(state, "luke_littler", seqRng([0.02, 0.02, t * 0.01]));
      if (dart && (dart.kind === "single" || dart.kind === "double" || dart.kind === "triple")) {
        if (dart.number === 4) on4 += 1;
        if (dart.number === 20) on20 += 1;
      }
    }
    expect(on4).toBeGreaterThan(on20);
  });

  it("killer aims the assigned double to arm", () => {
    const state = createGame({
      modeConfig: {
        mode: "killer",
        config: {
          lives: 3,
          playerNumbers: { bot1: 11, human: 7 },
          doublesOnly: true,
        },
      },
      players: [
        {
          id: "bot1",
          name: "Luke Littler",
          isGuest: true,
          isBot: true,
          botDifficulty: "luke_littler",
        },
        { id: "human", name: "Patron", isGuest: true },
      ],
      matchFormat: { legsToWin: 1, setsToWin: 1 },
    });
    const dart = generateNextBotDart(state, "luke_littler", seqRng([0.0, 0.0, 0.0]));
    expect(dart?.kind).toBe("double");
    expect(dart?.number).toBe(11);
  });
});

describe("bot dart source tag", () => {
  it("createDart accepts source bot", () => {
    const d = createDart("triple", 20, { source: "bot" });
    expect(d.source).toBe("bot");
    expect(d.value).toBe(60);
  });
});
