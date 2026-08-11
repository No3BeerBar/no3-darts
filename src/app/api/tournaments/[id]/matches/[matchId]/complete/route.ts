import { NextResponse } from "next/server";
import { TournamentError, completeTournamentMatch } from "@/lib/tournament/server";

type Ctx = { params: Promise<{ id: string; matchId: string }> };

/** Report winner, free lane, advance bracket. */
export async function POST(request: Request, ctx: Ctx) {
  const { id, matchId } = await ctx.params;
  try {
    const body = (await request.json()) as {
      winnerId?: string;
      liveGameId?: string | null;
      legsWonA?: number;
      legsWonB?: number;
    };
    if (!body.winnerId?.trim()) {
      return NextResponse.json({ ok: false, error: "winnerId is required" }, { status: 400 });
    }
    const tournament = await completeTournamentMatch(id, matchId, {
      winnerId: body.winnerId.trim(),
      liveGameId: body.liveGameId,
      legsWonA: body.legsWonA,
      legsWonB: body.legsWonB,
    });
    return NextResponse.json({ ok: true, tournament });
  } catch (err) {
    if (err instanceof TournamentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error("[tournaments] complete", err);
    return NextResponse.json({ ok: false, error: "Failed to complete match" }, { status: 500 });
  }
}
