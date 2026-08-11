/**
 * Pure helpers for bar TV / server leaderboards.
 * Weekly windows use match finished_at; all-time aggregates match rows (mode-aware).
 */

export type LeaderboardMetric =
  | "avg"
  | "wins"
  | "oneEighties"
  | "highestCheckout"
  | "highScore";

export type LeaderboardEntry = {
  playerId: string;
  name: string;
  matchesPlayed: number;
  matchesWon: number;
  oneEighties: number;
  highestCheckout: number;
  /** Best finishing score in the window (mode games like Baseball / 41) */
  highScore: number;
  /** Three-dart average for the window (or career) */
  avg: number;
  dartsThrown: number;
  totalScore: number;
};

export type MatchPlayerRow = {
  playerId: string;
  name: string;
  finishedAt: number;
  /** Game mode id (e.g. killer, baseball, forty_one, x01). */
  mode: string;
  avg: number;
  oneEighties: number;
  highestCheckout: number;
  dartsThrown: number;
  totalScore: number;
  /** Finishing score for the match (playerStates.score); 0 if unknown */
  finalScore: number;
  won: boolean;
};

/** Modes that prefer wins boards over X01-centric avg/180s/high-out. */
export const WINS_FIRST_MODES = new Set([
  "killer",
  "baseball",
  "forty_one",
  "cricket",
  "countup",
  "shanghai",
  "bermuda",
  "around_the_clock",
  "random_checkout",
]);

/** Modes that also rank finishing score (Baseball, 41, …). */
export const HIGH_SCORE_MODES = new Set(["baseball", "forty_one", "countup", "shanghai"]);

export function filterRowsByGameMode(
  rows: MatchPlayerRow[],
  gameMode: string | undefined | null
): MatchPlayerRow[] {
  return filterRowsByMode(rows, gameMode || "all");
}

/** Metrics to rank for a mode. Unknown / empty → full metric set. */
export function metricsForGameMode(
  gameMode?: string | null
): Array<{ id: LeaderboardMetric; label: string; shortLabel: string }> {
  if (!gameMode || gameMode === "all") return LEADERBOARD_METRICS;
  if (HIGH_SCORE_MODES.has(gameMode)) {
    return LEADERBOARD_METRICS.filter((m) => m.id === "wins" || m.id === "highScore");
  }
  if (WINS_FIRST_MODES.has(gameMode)) {
    return LEADERBOARD_METRICS.filter((m) => m.id === "wins");
  }
  if (gameMode === "x01") {
    return LEADERBOARD_METRICS.filter((m) => m.id !== "highScore");
  }
  return LEADERBOARD_METRICS;
}

const MS_DAY = 24 * 60 * 60 * 1000;

/** Rolling 7-day window start (UTC ms). */
export function rollingWeekStart(nowMs: number = Date.now()): number {
  return nowMs - 7 * MS_DAY;
}

/**
 * Start of the ISO-ish bar week (Monday 00:00 local), as epoch ms.
 * `weekStartsOn`: 0=Sunday … 1=Monday (default).
 */
export function calendarWeekStart(
  nowMs: number = Date.now(),
  weekStartsOn: 0 | 1 = 1
): number {
  const d = new Date(nowMs);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = (day - weekStartsOn + 7) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export function threeDartAvg(totalScore: number, dartsThrown: number): number {
  if (!dartsThrown || dartsThrown <= 0) return 0;
  return (totalScore / dartsThrown) * 3;
}

export function filterRowsByMode(
  rows: MatchPlayerRow[],
  mode: string | null | undefined
): MatchPlayerRow[] {
  if (!mode || mode === "all") return rows;
  return rows.filter((r) => r.mode === mode);
}

/** Aggregate per-player rows that already fall inside a finished_at window. */
export function aggregateMatchRows(rows: MatchPlayerRow[]): LeaderboardEntry[] {
  const byId = new Map<string, LeaderboardEntry>();

  for (const r of rows) {
    if (!r.playerId) continue;
    let e = byId.get(r.playerId);
    if (!e) {
      e = {
        playerId: r.playerId,
        name: r.name,
        matchesPlayed: 0,
        matchesWon: 0,
        oneEighties: 0,
        highestCheckout: 0,
        highScore: 0,
        avg: 0,
        dartsThrown: 0,
        totalScore: 0,
      };
      byId.set(r.playerId, e);
    }
    e.name = r.name || e.name;
    e.matchesPlayed += 1;
    if (r.won) e.matchesWon += 1;
    e.oneEighties += r.oneEighties || 0;
    e.highestCheckout = Math.max(e.highestCheckout, r.highestCheckout || 0);
    e.highScore = Math.max(e.highScore, r.finalScore || 0);
    e.dartsThrown += r.dartsThrown || 0;
    e.totalScore += r.totalScore || 0;
  }

  for (const e of byId.values()) {
    e.avg =
      e.dartsThrown > 0
        ? threeDartAvg(e.totalScore, e.dartsThrown)
        : // fallback: mean of match avgs if darts weren't stored
          0;
  }

  // If no dart totals, fall back to average of per-match avgs
  const needsFallback = [...byId.values()].filter((e) => e.dartsThrown <= 0 && e.matchesPlayed > 0);
  if (needsFallback.length) {
    const sumAvg = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      if (!r.playerId || (r.dartsThrown || 0) > 0) continue;
      const cur = sumAvg.get(r.playerId) ?? { sum: 0, n: 0 };
      cur.sum += r.avg || 0;
      cur.n += 1;
      sumAvg.set(r.playerId, cur);
    }
    for (const e of needsFallback) {
      const s = sumAvg.get(e.playerId);
      e.avg = s && s.n ? s.sum / s.n : 0;
    }
  }

  return [...byId.values()];
}

export function filterByFinishedSince(
  rows: MatchPlayerRow[],
  sinceMs: number
): MatchPlayerRow[] {
  return rows.filter((r) => r.finishedAt >= sinceMs);
}

export function metricValue(entry: LeaderboardEntry, metric: LeaderboardMetric): number {
  switch (metric) {
    case "wins":
      return entry.matchesWon;
    case "oneEighties":
      return entry.oneEighties;
    case "highestCheckout":
      return entry.highestCheckout;
    case "highScore":
      return entry.highScore;
    case "avg":
    default:
      return entry.avg;
  }
}

/**
 * Rank entries for a metric. Higher is better.
 * Ties broken by matchesPlayed then name.
 */
export function rankLeaderboard(
  entries: LeaderboardEntry[],
  metric: LeaderboardMetric,
  opts: { minMatches?: number; limit?: number } = {}
): LeaderboardEntry[] {
  const minMatches = opts.minMatches ?? 1;
  const limit = opts.limit ?? 10;

  return [...entries]
    .filter((e) => e.matchesPlayed >= minMatches)
    .filter((e) => {
      // Hide zeroed boards for sparse metrics (except avg after min matches)
      if (metric === "wins") return e.matchesWon > 0;
      if (metric === "oneEighties") return e.oneEighties > 0;
      if (metric === "highestCheckout") return e.highestCheckout > 0;
      if (metric === "highScore") return e.highScore > 0;
      if (metric === "avg") return e.avg > 0 || e.dartsThrown > 0;
      return true;
    })
    .sort((a, b) => {
      const diff = metricValue(b, metric) - metricValue(a, metric);
      if (diff !== 0) return diff;
      if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export const LEADERBOARD_METRICS: Array<{
  id: LeaderboardMetric;
  label: string;
  shortLabel: string;
}> = [
  { id: "avg", label: "Three-dart average", shortLabel: "AVG" },
  { id: "wins", label: "Match wins", shortLabel: "WINS" },
  { id: "oneEighties", label: "180s", shortLabel: "180s" },
  { id: "highestCheckout", label: "Highest checkout", shortLabel: "HIGH OUT" },
  { id: "highScore", label: "Highest finishing score", shortLabel: "HIGH SCORE" },
];

export function formatLeaderboardValue(
  entry: LeaderboardEntry,
  metric: LeaderboardMetric
): string {
  const v = metricValue(entry, metric);
  if (metric === "avg") return (Math.round(v * 10) / 10).toFixed(1);
  return String(Math.round(v));
}
