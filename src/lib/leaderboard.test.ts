import { describe, expect, it } from "vitest";
import {
  aggregateMatchRows,
  calendarWeekStart,
  filterByFinishedSince,
  formatLeaderboardValue,
  metricValue,
  rankLeaderboard,
  rollingWeekStart,
  threeDartAvg,
  type MatchPlayerRow,
} from "./leaderboard";

function row(partial: Partial<MatchPlayerRow> & Pick<MatchPlayerRow, "playerId" | "name">): MatchPlayerRow {
  return {
    finishedAt: Date.now(),
    avg: 0,
    oneEighties: 0,
    highestCheckout: 0,
    dartsThrown: 0,
    totalScore: 0,
    won: false,
    ...partial,
  };
}

describe("rollingWeekStart / calendarWeekStart", () => {
  it("rolling window is exactly 7 days before now", () => {
    const now = Date.parse("2026-08-11T19:00:00.000Z");
    expect(rollingWeekStart(now)).toBe(now - 7 * 24 * 60 * 60 * 1000);
  });

  it("calendar week starts Monday local midnight", () => {
    // Wednesday Aug 12 2026 15:00 local — week start should be Mon Aug 10
    const wed = new Date(2026, 7, 12, 15, 0, 0, 0).getTime();
    const start = calendarWeekStart(wed, 1);
    const d = new Date(start);
    expect(d.getDay()).toBe(1); // Monday
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(10);
  });

  it("Sunday belongs to prior Monday week when weekStartsOn=1", () => {
    const sun = new Date(2026, 7, 16, 12, 0, 0, 0).getTime(); // Sun Aug 16
    const start = calendarWeekStart(sun, 1);
    const d = new Date(start);
    expect(d.getDay()).toBe(1);
    expect(d.getDate()).toBe(10); // Mon Aug 10
  });
});

describe("filterByFinishedSince", () => {
  it("keeps only rows at or after since", () => {
    const since = 1_000;
    const rows = [
      row({ playerId: "a", name: "A", finishedAt: 999 }),
      row({ playerId: "b", name: "B", finishedAt: 1000 }),
      row({ playerId: "c", name: "C", finishedAt: 2000 }),
    ];
    expect(filterByFinishedSince(rows, since).map((r) => r.playerId)).toEqual(["b", "c"]);
  });
});

describe("aggregateMatchRows + rankLeaderboard", () => {
  const sample: MatchPlayerRow[] = [
    row({
      playerId: "p1",
      name: "Alex",
      finishedAt: 100,
      dartsThrown: 30,
      totalScore: 600, // avg 60
      oneEighties: 1,
      highestCheckout: 80,
      won: true,
    }),
    row({
      playerId: "p1",
      name: "Alex",
      finishedAt: 200,
      dartsThrown: 30,
      totalScore: 450, // avg 45 → career (1050/60)*3 = 52.5
      oneEighties: 0,
      highestCheckout: 40,
      won: false,
    }),
    row({
      playerId: "p2",
      name: "Bea",
      finishedAt: 150,
      dartsThrown: 21,
      totalScore: 560, // avg ~80
      oneEighties: 2,
      highestCheckout: 120,
      won: true,
    }),
    row({
      playerId: "p3",
      name: "Cara",
      finishedAt: 180,
      dartsThrown: 9,
      totalScore: 90, // avg 30
      oneEighties: 0,
      highestCheckout: 0,
      won: false,
    }),
  ];

  it("aggregates wins / 180s / high out / weighted avg", () => {
    const entries = aggregateMatchRows(sample);
    const alex = entries.find((e) => e.playerId === "p1")!;
    expect(alex.matchesPlayed).toBe(2);
    expect(alex.matchesWon).toBe(1);
    expect(alex.oneEighties).toBe(1);
    expect(alex.highestCheckout).toBe(80);
    expect(alex.avg).toBeCloseTo(threeDartAvg(1050, 60), 5);

    const bea = entries.find((e) => e.playerId === "p2")!;
    expect(bea.matchesWon).toBe(1);
    expect(bea.oneEighties).toBe(2);
    expect(bea.highestCheckout).toBe(120);
  });

  it("ranks by avg descending", () => {
    const ranked = rankLeaderboard(aggregateMatchRows(sample), "avg", { limit: 10 });
    expect(ranked.map((e) => e.playerId)).toEqual(["p2", "p1", "p3"]);
    expect(metricValue(ranked[0], "avg")).toBeGreaterThan(metricValue(ranked[1], "avg"));
  });

  it("ranks 180s and omits zeros", () => {
    const ranked = rankLeaderboard(aggregateMatchRows(sample), "oneEighties");
    expect(ranked.map((e) => e.playerId)).toEqual(["p2", "p1"]);
  });

  it("respects minMatches threshold", () => {
    const ranked = rankLeaderboard(aggregateMatchRows(sample), "avg", {
      minMatches: 2,
    });
    expect(ranked.map((e) => e.playerId)).toEqual(["p1"]);
  });

  it("formats avg to one decimal", () => {
    const [top] = rankLeaderboard(aggregateMatchRows(sample), "avg");
    expect(formatLeaderboardValue(top, "avg")).toMatch(/^\d+\.\d$/);
  });
});
