import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/db";
import { listPublicPlayers } from "@/lib/players-server";

/** Public player list for the tablet picker — never includes pin hashes. */
export async function GET() {
  const players = await listPublicPlayers();
  if (players === null) {
    return NextResponse.json({
      ok: true,
      players: [],
      dbConfigured: isDatabaseConfigured(),
      dbAvailable: false,
    });
  }
  return NextResponse.json({
    ok: true,
    players,
    dbConfigured: isDatabaseConfigured(),
    dbAvailable: true,
  });
}
