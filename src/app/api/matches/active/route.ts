import { NextResponse } from "next/server";
import {
  checkCameraAuth,
  getActiveByRoom,
  listServerMatches,
} from "@/lib/server-game-store";

/** GET /api/matches/active?room=Board%201 */
export async function GET(request: Request) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
