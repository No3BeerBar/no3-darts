import { NextResponse } from "next/server";
import { readStaffPin, staffUnauthorized } from "@/lib/auth/require-staff";
import { TournamentError, assignMatchLane } from "@/lib/tournament/server";

type Ctx = { params: Promise<{ id: string; matchId: string }> };

/** Assign (or free) a lane for a bracket match. Staff PIN required. */
export async function POST(request: Request, ctx: Ctx) {
  const { id, matchId } = await ctx.params;
  try {
    const body = (await request.json()) as { lane?: string | null; staffPin?: string };
    const denied = staffUnauthorized(readStaffPin(request, body));
    if (denied) return denied;
    const match = await assignMatchLane(id, matchId, body.lane ?? null);
    return NextResponse.json({ ok: true, match });
  } catch (err) {
    if (err instanceof TournamentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error("[tournaments] assign", err);
    return NextResponse.json({ ok: false, error: "Failed to assign lane" }, { status: 500 });
  }
}
