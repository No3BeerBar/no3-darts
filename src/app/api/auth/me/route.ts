import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getPublicPlayer } from "@/lib/players-server";
import { isDatabaseConfigured } from "@/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({
      ok: true,
      player: null,
      dbConfigured: isDatabaseConfigured(),
    });
  }

  const player = await getPublicPlayer(session.playerId);
  if (!player) {
    // Stale cookie after DB wipe / player deleted
    return NextResponse.json({
      ok: true,
      player: null,
      dbConfigured: isDatabaseConfigured(),
    });
  }

  return NextResponse.json({
    ok: true,
    player,
    dbConfigured: isDatabaseConfigured(),
  });
}
