import { NextResponse } from "next/server";
import { readStaffPin, staffUnauthorized } from "@/lib/auth/require-staff";
import { TournamentError, startTournament } from "@/lib/tournament/server";

type Ctx = { params: Promise<{ id: string }> };

/** Build bracket and set status → active. Staff PIN required. */
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const denied = staffUnauthorized(readStaffPin(request, body));
    if (denied) return denied;
    const tournament = await startTournament(id);
    return NextResponse.json({ ok: true, tournament });
  } catch (err) {
    if (err instanceof TournamentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error("[tournaments] start", err);
    return NextResponse.json({ ok: false, error: "Failed to start tournament" }, { status: 500 });
  }
}
