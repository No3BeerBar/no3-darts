import { NextResponse } from "next/server";
import { verifyPassportBearer } from "@/lib/auth/passport";
import { getChallengeStandings } from "@/lib/challenges/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Leaderboard for a challenge (registered progress only).
 * Auth: `Authorization: Bearer $PASSPORT_DARTS_SHARED_SECRET`
 * Passport owns announcement UI; this exposes standings + winner.
 */
export async function GET(req: Request, ctx: Ctx) {
  if (!verifyPassportBearer(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

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
