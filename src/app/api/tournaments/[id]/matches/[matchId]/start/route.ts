import { NextResponse } from "next/server";
import { TournamentError, linkLiveGame } from "@/lib/tournament/server";

type Ctx = { params: Promise<{ id: string; matchId: string }> };

/** Link a live GameState id and mark match in_progress. Body: { liveGameId } */
export async function POST(request: Request, ctx: Ctx) {
  const { id, matchId } = await ctx.params;
  try {
    const body = (await request.json()) as { liveGameId?: string };
    if (!body.liveGameId?.trim()) {
      return NextResponse.json({ ok: false, error: "liveGameId is required" }, { status: 400 });
    }
    const match = await linkLiveGame(id, matchId, body.liveGameId.trim());
    return NextResponse.json({ ok: true, match });
  } catch (err) {
    if (err instanceof TournamentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error("[tournaments] match start", err);
    return NextResponse.json({ ok: false, error: "Failed to start match" }, { status: 500 });
  }
}
