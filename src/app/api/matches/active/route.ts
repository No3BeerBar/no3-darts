import { NextResponse } from "next/server";
import { getActiveByRoom, listServerMatches } from "@/lib/server-game-store";

/**
 * GET /api/matches/active?room=Board%201
 * Public read for TV kiosk / attract idle detection (no camera key).
 * Write paths under /api/matches and /api/camera remain protected.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const room = searchParams.get("room");

  if (room) {
    const match = getActiveByRoom(room);
    if (!match) {
      return NextResponse.json(
        { match: null, serverTime: Date.now() },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }
    return NextResponse.json(
      { match, serverTime: Date.now() },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }

  const playing = listServerMatches().filter(
    (m) =>
      m.status === "playing" ||
      m.status === "paused" ||
      m.status === "leg_won" ||
      m.status === "match_won"
  );
  return NextResponse.json(
    { matches: playing, serverTime: Date.now() },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
