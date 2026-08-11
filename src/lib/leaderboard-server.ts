/**
 * Server-side leaderboard queries (Postgres). Degrades to null when DB is down.
 */

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  aggregateMatchRows,
  calendarWeekStart,
  LEADERBOARD_METRICS,
  mergeKillerWins,
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
  boards: LeaderboardBoards;
};

function emptyBoards(): LeaderboardBoards {
  return {
    avg: [],
    wins: [],
    killerWins: [],
    oneEighties: [],
    highestCheckout: [],
  };
}

function rankAllMetrics(
  entries: LeaderboardEntry[],
  opts: { minMatches: number; limit: number }
): LeaderboardBoards {
  const boards = emptyBoards();
  for (const m of LEADERBOARD_METRICS) {
    boards[m.id] = rankLeaderboard(entries, m.id, opts);
  }
  return boards;
}

async function loadMatchRowsSince(sinceMs: number): Promise<MatchPlayerRow[] | null> {
  const db = await getDb();
  if (!db) return null;

  const since = new Date(sinceMs);
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
    .where(
      and(isNotNull(schema.matchPlayers.playerId), gte(schema.matches.finishedAt, since))
    )
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
      killerWins: 0,
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

/**
 * All-time Killer wins for registered winners only (`winner_player_id` set → not guest).
 */
async function loadAllTimeKillerWins(): Promise<
  Array<{ playerId: string; name: string; killerWins: number }> | null
> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select({
      playerId: schema.matches.winnerPlayerId,
      name: schema.matches.winnerName,
      killerWins: sql<number>`count(*)::int`,
    })
    .from(schema.matches)
    .where(and(eq(schema.matches.mode, "killer"), isNotNull(schema.matches.winnerPlayerId)))
    .groupBy(schema.matches.winnerPlayerId, schema.matches.winnerName);

  return rows
    .filter((r) => r.playerId)
    .map((r) => ({
      playerId: r.playerId!,
      name: r.name ?? "Player",
      killerWins: Number(r.killerWins) || 0,
    }));
}

export type FetchLeaderboardsOptions = {
  nowMs?: number;
  /** rolling7 (default) or calendar Monday week */
  weekMode?: "rolling7" | "calendar";
  minMatches?: number;
  limit?: number;
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
} | null> {
  const now = opts.nowMs ?? Date.now();
  const weekMode = opts.weekMode ?? "rolling7";
  const minMatches = opts.minMatches ?? 1;
  const limit = opts.limit ?? 8;
  const rankOpts = { minMatches, limit };

  const since =
    weekMode === "calendar" ? calendarWeekStart(now, 1) : rollingWeekStart(now);

  try {
    const [weekRows, allEntries, killerAllTime] = await Promise.all([
      loadMatchRowsSince(since),
      loadAllTimeEntries(),
      loadAllTimeKillerWins(),
    ]);

    if (weekRows === null || allEntries === null || killerAllTime === null) {
      return null;
    }

    const weeklyEntries = aggregateMatchRows(weekRows);
    const allTimeEntries = mergeKillerWins(allEntries, killerAllTime);

    return {
      dbAvailable: true,
      weekly: {
        window: "week",
        since,
        until: now,
        mode: weekMode,
        boards: rankAllMetrics(weeklyEntries, rankOpts),
      },
      allTime: {
        window: "all",
        since: null,
        until: now,
        mode: "all",
        boards: rankAllMetrics(allTimeEntries, rankOpts),
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
