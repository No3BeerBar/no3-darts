import { NextResponse } from "next/server";
import { verifyPassportBearer } from "@/lib/auth/passport";
import { closeChallenge } from "@/lib/challenges/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Freeze a challenge (status=closed) and return final standings + winner.
 * Auth: `Authorization: Bearer $PASSPORT_DARTS_SHARED_SECRET`
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!verifyPassportBearer(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const result = await closeChallenge(id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    challenge: result.challenge,
    standings: result.standings,
    winner: result.winner,
  });
}
