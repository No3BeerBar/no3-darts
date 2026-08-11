/**
 * Server-side leaderboard queries (Postgres). Degrades to null when DB is down.
 * Mode-aware: every registered game mode can have wins (+ opt-in highScore / avg).
 */

import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { GameModeId } from "@/engine";
import { getDb, schema } from "@/db";
import {
  aggregateMatchRows,
  calendarWeekStart,
  filterRowsByMode,
  LEADERBOARD_METRICS,
  rankLeaderboard,
  rollingWeekStart,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type MatchPlayerRow,
} from "@/lib/leaderboard";
import {
  averageModes,
  checkoutModes,
  isKnownGameMode,
  listModeLeaderboardSpecs,
  metricsForMode,
  type ModeLeaderboardSpec,
} from "@/lib/mode-leaderboards";

export type LeaderboardBoards = Record<LeaderboardMetric, LeaderboardEntry[]>;

export type LeaderboardSlice = {
  window: "week" | "all";
  /** Epoch ms start of window (null for all-time) */
  since: number | null;
  until: number;
  /**
   * Week window kind (legacy field name `mode` — not a game mode).
   * Prefer `weekMode` in new clients.
   */
  mode: "rolling7" | "calendar" | "all";
  weekMode: "rolling7" | "calendar" | "all";
  /** Game mode filter applied to `boards` (`all` = overall / mixed) */
  gameMode: GameModeId | "all";
  boards: LeaderboardBoards;
  /** Per-mode boards (always populated when rows exist) for TV attract */
  byMode: Partial<Record<GameModeId, LeaderboardBoards>>;
};

function emptyBoards(): LeaderboardBoards {
  return {
    avg: [],
    wins: [],
    oneEighties: [],
    highestCheckout: [],
    highScore: [],
  };
}

function rankMetrics(
  entries: LeaderboardEntry[],
  metrics: LeaderboardMetric[],
  opts: { minMatches: number; limit: number }
): LeaderboardBoards {
  const boards = emptyBoards();
  for (const id of metrics) {
    boards[id] = rankLeaderboard(entries, id, opts);
  }
  return boards;
}

/** Overall boards: avg/checkout from modes that opt in; wins across all; highScore from high-score modes. */
function rankOverallBoards(
  rows: MatchPlayerRow[],
  opts: { minMatches: number; limit: number }
): LeaderboardBoards {
  const boards = emptyBoards();
  const avgModeSet = new Set(averageModes());
  const checkoutModeSet = new Set(checkoutModes());

  boards.wins = rankLeaderboard(aggregateMatchRows(rows), "wins", opts);
  boards.avg = rankLeaderboard(
    aggregateMatchRows(rows.filter((r) => avgModeSet.has(r.mode as GameModeId))),
    "avg",
    opts
  );
  boards.oneEighties = rankLeaderboard(
    aggregateMatchRows(rows.filter((r) => checkoutModeSet.has(r.mode as GameModeId))),
    "oneEighties",
    opts
  );
  boards.highestCheckout = rankLeaderboard(
    aggregateMatchRows(rows.filter((r) => checkoutModeSet.has(r.mode as GameModeId))),
    "highestCheckout",
    opts
  );
  // Overall high-score mixes Baseball/41/etc. — useful overview; per-mode is in byMode
  boards.highScore = rankLeaderboard(aggregateMatchRows(rows), "highScore", opts);
  return boards;
}

function buildByMode(
  rows: MatchPlayerRow[],
  opts: { minMatches: number; limit: number }
): Partial<Record<GameModeId, LeaderboardBoards>> {
  const byMode: Partial<Record<GameModeId, LeaderboardBoards>> = {};
  for (const spec of listModeLeaderboardSpecs()) {
    const modeRows = filterRowsByMode(rows, spec.mode);
    if (modeRows.length === 0) continue;
    byMode[spec.mode] = rankMetrics(
      aggregateMatchRows(modeRows),
      spec.metrics,
      opts
    );
  }
  return byMode;
}

async function loadMatchRows(sinceMs?: number): Promise<MatchPlayerRow[] | null> {
  const db = await getDb();
  if (!db) return null;

  const base = db
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
      finalScore: schema.matchPlayers.finalScore,
      winnerPlayerId: schema.matches.winnerPlayerId,
    })
    .from(schema.matchPlayers)
    .innerJoin(schema.matches, eq(schema.matchPlayers.matchId, schema.matches.id));

  const rows =
    sinceMs != null
      ? await base
          .where(
            and(
              isNotNull(schema.matchPlayers.playerId),
              gte(schema.matches.finishedAt, new Date(sinceMs))
            )
          )
          .orderBy(desc(schema.matches.finishedAt))
      : await base
          .where(isNotNull(schema.matchPlayers.playerId))
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
      finalScore: r.finalScore ?? 0,
      won: r.winnerPlayerId === r.playerId,
    }));
}

export type FetchLeaderboardsOptions = {
  nowMs?: number;
  /** rolling7 (default) or calendar Monday week */
  weekMode?: "rolling7" | "calendar";
  /** Filter top-level `boards` to one game mode; `all` = overall */
  gameMode?: GameModeId | "all";
  minMatches?: number;
  limit?: number;
};

/**
 * Fetch weekly + all-time boards. Returns null when DB unavailable
 * (caller should show empty / games-only attract state).
 */
export async function fetchLeaderboardSlices(
  opts: FetchLeaderboardsOptions = {}
): Promise<{
  dbAvailable: boolean;
  modeCatalog: ModeLeaderboardSpec[];
  weekly: LeaderboardSlice;
  allTime: LeaderboardSlice;
} | null> {
  const now = opts.nowMs ?? Date.now();
  const weekMode = opts.weekMode ?? "rolling7";
  const gameMode = opts.gameMode ?? "all";
  const minMatches = opts.minMatches ?? 1;
  const limit = opts.limit ?? 8;
  const rankOpts = { minMatches, limit };
  const modeCatalog = listModeLeaderboardSpecs();

  const since =
    weekMode === "calendar" ? calendarWeekStart(now, 1) : rollingWeekStart(now);

  try {
    const [weekRows, allRows] = await Promise.all([
      loadMatchRows(since),
      loadMatchRows(undefined),
    ]);

    if (weekRows === null || allRows === null) {
      return null;
    }

    const weeklyByMode = buildByMode(weekRows, rankOpts);
    const allByMode = buildByMode(allRows, rankOpts);

    const weeklyBoards =
      gameMode === "all"
        ? rankOverallBoards(weekRows, rankOpts)
        : rankMetrics(
            aggregateMatchRows(filterRowsByMode(weekRows, gameMode)),
            metricsForMode(gameMode),
            rankOpts
          );

    const allBoards =
      gameMode === "all"
        ? rankOverallBoards(allRows, rankOpts)
        : rankMetrics(
            aggregateMatchRows(filterRowsByMode(allRows, gameMode)),
            metricsForMode(gameMode),
            rankOpts
          );

    return {
      dbAvailable: true,
      modeCatalog,
      weekly: {
        window: "week",
        since,
        until: now,
        mode: weekMode,
        weekMode,
        gameMode,
        boards: weeklyBoards,
        byMode: weeklyByMode,
      },
      allTime: {
        window: "all",
        since: null,
        until: now,
        mode: "all",
        weekMode: "all",
        gameMode,
        boards: allBoards,
        byMode: allByMode,
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

export { isKnownGameMode, listModeLeaderboardSpecs };
