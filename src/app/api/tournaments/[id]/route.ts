import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/db";
import { readStaffPin, staffUnauthorized } from "@/lib/auth/require-staff";
import {
  TournamentError,
  getTournament,
  listTournaments,
  updateTournament,
} from "@/lib/tournament/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const tournament = await getTournament(id);
  if (tournament) {
    return NextResponse.json({ ok: true, tournament, dbAvailable: true });
  }

  // null ⇒ missing row or DB down
  const probe = await listTournaments();
  if (probe === null) {
    return NextResponse.json(
      {
        ok: false,
        error: "Database unavailable",
        dbConfigured: isDatabaseConfigured(),
        dbAvailable: false,
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: false, error: "Tournament not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = (await request.json()) as {
      name?: string;
      format?: Parameters<typeof updateTournament>[1]["format"];
      players?: Parameters<typeof updateTournament>[1]["players"];
      staffPin?: string;
    };
    const denied = staffUnauthorized(readStaffPin(request, body));
    if (denied) return denied;
    const tournament = await updateTournament(id, body);
    return NextResponse.json({ ok: true, tournament });
  } catch (err) {
    if (err instanceof TournamentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error("[tournaments] PATCH", err);
    return NextResponse.json({ ok: false, error: "Failed to update tournament" }, { status: 500 });
  }
}
