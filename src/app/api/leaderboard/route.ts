import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/db";
import { LEADERBOARD_METRICS } from "@/lib/leaderboard";
import {
  fetchLeaderboardSlices,
  isKnownGameMode,
  listModeLeaderboardSpecs,
} from "@/lib/leaderboard-server";

/**
 * GET /api/leaderboard
 * Weekly + all-time boards for **registered (PIN) players only** (TV attract / Stats).
 * Guests never appear — they may play, but keep no history or leaderboard credit.
 *
 * Query:
 *   weekMode=rolling7|calendar  (default rolling7)
 *   mode=all|<GameModeId>       game mode filter for top-level `boards` (default all)
 *   gameMode=…                  alias of `mode` (Killer bar-ready compat)
 *   minMatches=1
 *   limit=8
 *
 * Metrics (see LEADERBOARD_METRICS):
 *   avg            — 3-dart average (modes with leaderboard.average, e.g. X01)
 *   wins           — match wins (every registered mode, including Killer)
 *   oneEighties    — 180s (checkout-stat modes)
 *   highestCheckout
 *   highScore      — best finishing score (Baseball, 41, Count-Up, …)
 *
 * Response also includes:
 *   modeCatalog — every engine mode + which metrics it ranks
 *   weekly/allTime.byMode — per-mode boards for attract / Stats page
 *   gameMode — echo of the filter applied
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weekMode =
    searchParams.get("weekMode") === "calendar" ? "calendar" : "rolling7";
  const modeParam = searchParams.get("mode") ?? searchParams.get("gameMode") ?? "all";
  const gameMode =
    modeParam === "all" || !modeParam
      ? "all"
      : isKnownGameMode(modeParam)
        ? modeParam
        : "all";
  const minMatches = Math.max(1, Number(searchParams.get("minMatches") ?? "1") || 1);
  const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit") ?? "8") || 8));
  const modeCatalog = listModeLeaderboardSpecs();

  try {
    const data = await fetchLeaderboardSlices({
      weekMode,
      gameMode,
      minMatches,
      limit,
    });

    if (!data) {
      return NextResponse.json(
        {
          ok: true,
          dbConfigured: isDatabaseConfigured(),
          dbAvailable: false,
          gameMode,
          metrics: LEADERBOARD_METRICS,
          modeCatalog,
          weekly: null,
          allTime: null,
        },
        {
          headers: {
            "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
          },
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        dbConfigured: true,
        dbAvailable: true,
        gameMode: data.allTime.gameMode ?? gameMode,
        metrics: LEADERBOARD_METRICS,
        modeCatalog: data.modeCatalog,
        weekly: data.weekly,
        allTime: data.allTime,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    console.warn(
      "[no3-darts] /api/leaderboard error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      {
        ok: true,
        dbConfigured: isDatabaseConfigured(),
        dbAvailable: false,
        gameMode,
        metrics: LEADERBOARD_METRICS,
        modeCatalog,
        weekly: null,
        allTime: null,
        error: "leaderboard_unavailable",
      },
      { status: 200 }
    );
  }
}
