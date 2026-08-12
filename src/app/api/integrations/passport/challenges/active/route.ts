import { NextResponse } from "next/server";
import { verifyPassportBearer } from "@/lib/auth/passport";
import { listActiveChallenges } from "@/lib/challenges/server";

/**
 * GET active challenges (window contains now, status=active).
 * Auth: `Authorization: Bearer $PASSPORT_DARTS_SHARED_SECRET`
 */
export async function GET(req: Request) {
  if (!verifyPassportBearer(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const challenges = await listActiveChallenges();
  return NextResponse.json({ ok: true, challenges });
}
