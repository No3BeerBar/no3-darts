import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/db";
import { LEADERBOARD_METRICS } from "@/lib/leaderboard";
import { fetchLeaderboardSlices } from "@/lib/leaderboard-server";

/**
 * GET /api/leaderboard
 * Weekly + all-time boards for registered players (TV attract / shared stats).
 *
 * Query:
 *   weekMode=rolling7|calendar  (default rolling7)
 *   minMatches=1
 *   limit=8
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weekMode =
    searchParams.get("weekMode") === "calendar" ? "calendar" : "rolling7";
  const minMatches = Math.max(1, Number(searchParams.get("minMatches") ?? "1") || 1);
  const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit") ?? "8") || 8));

  try {
    const data = await fetchLeaderboardSlices({ weekMode, minMatches, limit });

    if (!data) {
      return NextResponse.json(
        {
          ok: true,
          dbConfigured: isDatabaseConfigured(),
          dbAvailable: false,
          metrics: LEADERBOARD_METRICS,
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
        metrics: LEADERBOARD_METRICS,
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
        metrics: LEADERBOARD_METRICS,
        weekly: null,
        allTime: null,
        error: "leaderboard_unavailable",
      },
      { status: 200 }
    );
  }
}
