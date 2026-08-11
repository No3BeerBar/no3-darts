/**
 * Server-side leaderboard queries (Postgres). Degrades to null when DB is down.
 */

import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  aggregateMatchRows,
  calendarWeekStart,
  metricsForGameMode,
  rankLeaderboard,
  rollingWeekStart,
  threeDartAvg,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type MatchPlayerRow,
} from "@/lib/leaderboard";

export type LeaderboardBoards = Record<LeaderboardMetric, LeaderboardEntry[]>;

export type LeaderboardSlice = {
  window: "week" | "all";
  /** Epoch ms start of window (null for all-time) */
  since: number | null;
  until: number;
  mode: "rolling7" | "calendar" | "all";
  /** Optional game mode filter (killer, baseball, …). */
  gameMode?: string | null;
  boards: LeaderboardBoards;
};

function emptyBoards(): LeaderboardBoards {
  return {
    avg: [],
    wins: [],
    oneEighties: [],
    highestCheckout: [],
  };
}

function rankMetrics(
  entries: LeaderboardEntry[],
  opts: { minMatches: number; limit: number; gameMode?: string | null }
): LeaderboardBoards {
  const boards = emptyBoards();
  for (const m of metricsForGameMode(opts.gameMode)) {
    boards[m.id] = rankLeaderboard(entries, m.id, opts);
  }
  return boards;
}

async function loadMatchRows(opts: {
  sinceMs?: number | null;
  gameMode?: string | null;
}): Promise<MatchPlayerRow[] | null> {
  const db = await getDb();
  if (!db) return null;

  const conditions = [isNotNull(schema.matchPlayers.playerId)];
  if (opts.sinceMs != null) {
    conditions.push(gte(schema.matches.finishedAt, new Date(opts.sinceMs)));
  }
  if (opts.gameMode) {
    conditions.push(eq(schema.matches.mode, opts.gameMode));
  }

  const rows = await db
    .select({
      playerId: schema.matchPlayers.playerId,
      name: schema.matchPlayers.name,
      finishedAt: schema.matches.finishedAt,
      mode: schema.matches.mode,
      avg: schema.matchPlayers.avg,
      oneEighties: schema.matchPlayers.oneEighties,
      highestCheckout: schema.matchPlayers.highestCheckout,
      dartsThrown: schema.matchPlayers.dartsThrown,
      totalScore: schema.matchPlayers.totalScore,
      winnerPlayerId: schema.matches.winnerPlayerId,
    })
    .from(schema.matchPlayers)
    .innerJoin(schema.matches, eq(schema.matchPlayers.matchId, schema.matches.id))
    .where(and(...conditions))
    .orderBy(desc(schema.matches.finishedAt));

  return rows
    .filter((r) => r.playerId)
    .map((r) => ({
      playerId: r.playerId!,
      name: r.name,
      finishedAt: r.finishedAt.getTime(),
      mode: r.mode,
      avg: r.avg,
      oneEighties: r.oneEighties,
      highestCheckout: r.highestCheckout,
      dartsThrown: r.dartsThrown,
      totalScore: r.totalScore,
      won: r.winnerPlayerId === r.playerId,
    }));
}

/** @deprecated prefer loadMatchRows — kept for any callers during mode-filter rollout */
async function loadMatchRowsSince(sinceMs: number): Promise<MatchPlayerRow[] | null> {
  return loadMatchRows({ sinceMs });
}

async function loadAllTimeEntries(): Promise<LeaderboardEntry[] | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(schema.players);
  return rows
    .filter((p) => p.matchesPlayed > 0)
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      matchesPlayed: p.matchesPlayed,
      matchesWon: p.matchesWon,
      oneEighties: p.oneEighties,
      highestCheckout: p.highestCheckout,
      avg:
        p.dartsThrown > 0
          ? threeDartAvg(p.totalScore, p.dartsThrown)
          : p.bestThreeDartAvg,
      dartsThrown: p.dartsThrown,
      totalScore: p.totalScore,
    }));
}

export type FetchLeaderboardsOptions = {
  nowMs?: number;
  /** rolling7 (default) or calendar Monday week */
  weekMode?: "rolling7" | "calendar";
  minMatches?: number;
  limit?: number;
  /**
   * Optional game mode filter (e.g. killer, baseball).
   * When set, boards are ranked from matches of that mode only
   * (registered PIN players — guests already have null playerId).
   * Additive hook for per-mode boards; omit for global X01-style boards.
   */
  gameMode?: string | null;
};

/**
 * Fetch weekly + all-time boards. Returns null slices when DB unavailable
 * (caller should show empty / games-only attract state).
 */
export async function fetchLeaderboardSlices(
  opts: FetchLeaderboardsOptions = {}
): Promise<{
  dbAvailable: boolean;
  weekly: LeaderboardSlice;
  allTime: LeaderboardSlice;
  gameMode?: string | null;
} | null> {
  const now = opts.nowMs ?? Date.now();
  const weekMode = opts.weekMode ?? "rolling7";
  const minMatches = opts.minMatches ?? 1;
  const limit = opts.limit ?? 8;
  const gameMode = opts.gameMode?.trim() || null;
  const rankOpts = { minMatches, limit, gameMode };

  const since =
    weekMode === "calendar" ? calendarWeekStart(now, 1) : rollingWeekStart(now);

  try {
    // Per-mode boards always come from match rows (player aggregates are global).
    // Global all-time still uses career player aggregates for avg/180s continuity.
    if (gameMode) {
      const [weekRows, allRows] = await Promise.all([
        loadMatchRows({ sinceMs: since, gameMode }),
        loadMatchRows({ sinceMs: null, gameMode }),
      ]);
      if (weekRows === null || allRows === null) return null;

      return {
        dbAvailable: true,
        gameMode,
        weekly: {
          window: "week",
          since,
          until: now,
          mode: weekMode,
          gameMode,
          boards: rankMetrics(aggregateMatchRows(weekRows), rankOpts),
        },
        allTime: {
          window: "all",
          since: null,
          until: now,
          mode: "all",
          gameMode,
          boards: rankMetrics(aggregateMatchRows(allRows), rankOpts),
        },
      };
    }

    const [weekRows, allEntries] = await Promise.all([
      loadMatchRowsSince(since),
      loadAllTimeEntries(),
    ]);

    if (weekRows === null || allEntries === null) {
      return null;
    }

    const weeklyEntries = aggregateMatchRows(weekRows);

    return {
      dbAvailable: true,
      gameMode: null,
      weekly: {
        window: "week",
        since,
        until: now,
        mode: weekMode,
        gameMode: null,
        boards: rankMetrics(weeklyEntries, rankOpts),
      },
      allTime: {
        window: "all",
        since: null,
        until: now,
        mode: "all",
        gameMode: null,
        boards: rankMetrics(allEntries, rankOpts),
      },
    };
  } catch (err) {
    console.warn(
      "[no3-darts] leaderboard query failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
