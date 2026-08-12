import { NextResponse } from "next/server";
import { getChallenge, getChallengeStandings } from "@/lib/challenges/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Public challenge detail + standings (registered progress only).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const withStandings = url.searchParams.get("standings") !== "0";
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  if (withStandings) {
    const board = await getChallengeStandings(id, limit);
    if (!board) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      challenge: board.challenge,
      standings: board.standings,
      winner: board.winner,
    });
  }

  const challenge = await getChallenge(id);
  if (!challenge) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, challenge });
}
