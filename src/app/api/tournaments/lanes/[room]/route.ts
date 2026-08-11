import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/db";
import { getLaneAssignedMatch, getLaneOverview } from "@/lib/tournament/server";

type Ctx = { params: Promise<{ room: string }> };

/** Pull the match assigned to this lane (e.g. Board%201). */
export async function GET(_request: Request, ctx: Ctx) {
  const { room } = await ctx.params;
  const decoded = decodeURIComponent(room);
  const assigned = await getLaneAssignedMatch(decoded);
  if (assigned === null) {
    // Either no assignment or DB down — check
    const overview = await getLaneOverview();
    if (overview === null) {
      return NextResponse.json({
        ok: true,
        assigned: null,
        dbConfigured: isDatabaseConfigured(),
        dbAvailable: false,
      });
    }
    return NextResponse.json({
      ok: true,
      assigned: null,
      dbAvailable: true,
    });
  }
  return NextResponse.json({
    ok: true,
    assigned: {
      tournamentId: assigned.tournament.id,
      tournamentName: assigned.tournament.name,
      format: assigned.tournament.format,
      match: assigned.match,
      playerA: assigned.playerA,
      playerB: assigned.playerB,
    },
    dbAvailable: true,
  });
}
