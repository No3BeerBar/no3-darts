import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/db";
import { LEADERBOARD_METRICS, metricsForGameMode } from "@/lib/leaderboard";
import { fetchLeaderboardSlices } from "@/lib/leaderboard-server";

/**
 * GET /api/leaderboard
 * Weekly + all-time boards for registered players (TV attract / shared stats).
 *
 * Query:
 *   weekMode=rolling7|calendar  (default rolling7)
 *   minMatches=1
 *   limit=8
 *   gameMode=killer|baseball|…  (optional per-mode boards; guests excluded)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weekMode =
    searchParams.get("weekMode") === "calendar" ? "calendar" : "rolling7";
  const minMatches = Math.max(1, Number(searchParams.get("minMatches") ?? "1") || 1);
  const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit") ?? "8") || 8));
  const gameModeRaw = searchParams.get("gameMode")?.trim() || null;
  // Allowlist keeps the additive hook open for new modes (e.g. 41) without free-form SQL risk
  const gameMode =
    gameModeRaw && /^[a-z0-9_]{1,32}$/.test(gameModeRaw) ? gameModeRaw : null;
  const metrics = metricsForGameMode(gameMode);

  try {
    const data = await fetchLeaderboardSlices({ weekMode, minMatches, limit, gameMode });

    if (!data) {
      return NextResponse.json(
        {
          ok: true,
          dbConfigured: isDatabaseConfigured(),
          dbAvailable: false,
          gameMode,
          metrics,
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
        gameMode: data.gameMode ?? gameMode,
        metrics,
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
        weekly: null,
        allTime: null,
        error: "leaderboard_unavailable",
      },
      { status: 200 }
    );
  }
}
