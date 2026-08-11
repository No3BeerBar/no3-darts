import { describe, expect, it } from "vitest";
import {
  advanceWinner,
  assertLaneUnique,
  generateSingleElimBracket,
  nextPowerOfTwo,
  roundNameForSize,
} from "./bracket";
import { parseLegModePolicy, parseTournamentFormat, resolveModeForLeg } from "./modes";
import type { TournamentPlayer } from "./types";

function players(n: number): TournamentPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    tournamentId: "t1",
    displayName: `Player ${i + 1}`,
    isGuest: true,
    registeredPlayerId: null,
    seed: i + 1,
  }));
}

describe("nextPowerOfTwo", () => {
  it("pads up", () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(8)).toBe(8);
  });
});

describe("roundNameForSize", () => {
  it("names rounds for an 8-player bracket", () => {
    expect(roundNameForSize(8, 0)).toBe("Quarterfinals");
    expect(roundNameForSize(8, 1)).toBe("Semifinals");
    expect(roundNameForSize(8, 2)).toBe("Final");
  });
});

describe("generateSingleElimBracket", () => {
  it("builds power-of-2 with byes for 6 players", () => {
    let n = 0;
    const { matches, bracketSize, byeCount } = generateSingleElimBracket({
      tournamentId: "t1",
      players: players(6),
      idFactory: () => `m${++n}`,
    });

    expect(bracketSize).toBe(8);
    expect(byeCount).toBe(2);
    // 4 + 2 + 1 = 7 matches
    expect(matches).toHaveLength(7);

    const first = matches.filter((m) => m.roundIndex === 0);
    expect(first).toHaveLength(4);

    // Two byes auto-complete
    const byeWins = first.filter((m) => m.status === "complete");
    expect(byeWins).toHaveLength(2);

    // Two real matches ready
    const ready = first.filter((m) => m.status === "ready");
    expect(ready).toHaveLength(2);
    for (const m of ready) {
      expect(m.playerAId).toBeTruthy();
      expect(m.playerBId).toBeTruthy();
    }

    // Both byes feed the same semi (slots 0 & 1 → SF0); that semi becomes ready
    const semis = matches.filter((m) => m.roundIndex === 1);
    const sf0 = semis.find((m) => m.bracketSlot === 0)!;
    expect(sf0.playerAId).toBeTruthy();
    expect(sf0.playerBId).toBeTruthy();
    expect(sf0.status).toBe("ready");
    const sf1 = semis.find((m) => m.bracketSlot === 1)!;
    expect(sf1.playerAId).toBeNull();
    expect(sf1.playerBId).toBeNull();
  });

  it("builds clean 4-player bracket", () => {
    let n = 0;
    const { matches, byeCount } = generateSingleElimBracket({
      tournamentId: "t1",
      players: players(4),
      idFactory: () => `m${++n}`,
    });
    expect(byeCount).toBe(0);
    expect(matches).toHaveLength(3);
    expect(matches.filter((m) => m.status === "ready")).toHaveLength(2);
  });

  it("rejects fewer than 2 players", () => {
    expect(() =>
      generateSingleElimBracket({ tournamentId: "t1", players: players(1) })
    ).toThrow(/at least 2/);
  });
});

describe("advanceWinner", () => {
  it("feeds winner into next match and completes tournament on final", () => {
    let n = 0;
    const { matches } = generateSingleElimBracket({
      tournamentId: "t1",
      players: players(4),
      idFactory: () => `m${++n}`,
    });

    const m1 = matches.find((m) => m.roundIndex === 0 && m.bracketSlot === 0)!;
    m1.status = "complete";
    m1.winnerId = m1.playerAId;

    const step1 = advanceWinner(matches, m1.id);
    const next = step1.nextMatch!;
    expect(next.playerAId).toBe(m1.winnerId);
    expect(step1.tournamentComplete).toBe(false);

    const m2 = step1.matches.find((m) => m.roundIndex === 0 && m.bracketSlot === 1)!;
    const working = step1.matches.map((m) =>
      m.id === m2.id
        ? { ...m, status: "complete" as const, winnerId: m.playerBId }
        : m
    );
    const step2 = advanceWinner(working, m2.id);
    const final = step2.matches.find((m) => m.roundIndex === 1)!;
    expect(final.playerAId).toBeTruthy();
    expect(final.playerBId).toBeTruthy();
    expect(final.status).toBe("ready");

    const afterFinalSetup = step2.matches.map((m) =>
      m.id === final.id
        ? { ...m, status: "complete" as const, winnerId: m.playerAId }
        : m
    );
    const step3 = advanceWinner(afterFinalSetup, final.id);
    expect(step3.tournamentComplete).toBe(true);
    expect(step3.nextMatch).toBeNull();
  });
});

describe("assertLaneUnique", () => {
  it("allows free lane and blocks double-book", () => {
    const matches = [
      {
        id: "a",
        tournamentId: "t",
        roundIndex: 0,
        roundName: "Final",
        bracketSlot: 0,
        playerAId: "p1",
        playerBId: "p2",
        status: "in_progress" as const,
        winnerId: null,
        lane: "Board 1" as const,
        liveGameId: null,
        nextMatchId: null,
        nextMatchSlot: null,
        legsWonA: 0,
        legsWonB: 0,
      },
      {
        id: "b",
        tournamentId: "t",
        roundIndex: 0,
        roundName: "Final",
        bracketSlot: 1,
        playerAId: "p3",
        playerBId: "p4",
        status: "ready" as const,
        winnerId: null,
        lane: null,
        liveGameId: null,
        nextMatchId: null,
        nextMatchSlot: null,
        legsWonA: 0,
        legsWonB: 0,
      },
    ];
    expect(() => assertLaneUnique(matches, "Board 2")).not.toThrow();
    expect(() => assertLaneUnique(matches, "Board 1")).toThrow(/Board 1/);
    expect(() => assertLaneUnique(matches, "Board 1", "a")).not.toThrow();
  });
});

describe("legModePolicy parsing", () => {
  it("parses policies", () => {
    expect(parseLegModePolicy("fixed")).toBe("fixed");
    expect(parseLegModePolicy("choose_each_leg")).toBe("choose_each_leg");
    expect(parseLegModePolicy("preset_sequence")).toBe("preset_sequence");
    expect(() => parseLegModePolicy("random")).toThrow();
  });

  it("requires fixedModeConfig for fixed", () => {
    expect(() =>
      parseTournamentFormat({
        legsToWin: 2,
        legModePolicy: "fixed",
        allowedModes: ["x01"],
      })
    ).toThrow(/fixedModeConfig/);

    const ok = parseTournamentFormat({
      legsToWin: 2,
      legModePolicy: "fixed",
      allowedModes: ["x01"],
      fixedModeConfig: {
        mode: "x01",
        config: { startScore: 501, doubleIn: false, doubleOut: true },
      },
    });
    expect(ok.legsToWin).toBe(2);
  });

  it("requires presetSequence for preset_sequence", () => {
    expect(() =>
      parseTournamentFormat({
        legsToWin: 2,
        legModePolicy: "preset_sequence",
        allowedModes: ["x01", "cricket"],
      })
    ).toThrow(/presetSequence/);

    const ok = parseTournamentFormat({
      legsToWin: 2,
      legModePolicy: "preset_sequence",
      allowedModes: ["x01", "cricket"],
      presetSequence: [
        { mode: "x01", config: { startScore: 501, doubleIn: false, doubleOut: true } },
        { mode: "cricket", config: { variant: "standard" } },
      ],
    });
    expect(ok.presetSequence).toHaveLength(2);
  });

  it("resolves mode per leg", () => {
    const fixed = parseTournamentFormat({
      legsToWin: 2,
      legModePolicy: "fixed",
      allowedModes: ["x01"],
      fixedModeConfig: {
        mode: "x01",
        config: { startScore: 301, doubleIn: false, doubleOut: true },
      },
    });
    expect(resolveModeForLeg(fixed, 1)?.mode).toBe("x01");
    expect(resolveModeForLeg(fixed, 3)?.mode).toBe("x01");

    const choose = parseTournamentFormat({
      legsToWin: 2,
      legModePolicy: "choose_each_leg",
      allowedModes: ["x01", "cricket"],
    });
    expect(resolveModeForLeg(choose, 1)).toBeNull();

    const preset = parseTournamentFormat({
      legsToWin: 3,
      legModePolicy: "preset_sequence",
      allowedModes: ["x01", "cricket", "baseball"],
      presetSequence: [
        { mode: "x01", config: { startScore: 501, doubleIn: false, doubleOut: true } },
        { mode: "cricket", config: { variant: "standard" } },
        { mode: "baseball", config: { innings: 9 } },
      ],
    });
    expect(resolveModeForLeg(preset, 1)?.mode).toBe("x01");
    expect(resolveModeForLeg(preset, 2)?.mode).toBe("cricket");
    expect(resolveModeForLeg(preset, 3)?.mode).toBe("baseball");
  });
});
