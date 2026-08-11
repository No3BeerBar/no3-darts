import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/db";
import { readStaffPin, staffUnauthorized } from "@/lib/auth/require-staff";
import {
  TournamentError,
  createTournament,
  listTournaments,
} from "@/lib/tournament/server";

/** List tournaments (newest first). Degrades when DB is down. Staff UI gated client-side. */
export async function GET() {
  const list = await listTournaments();
  if (list === null) {
    return NextResponse.json({
      ok: true,
      tournaments: [],
      dbConfigured: isDatabaseConfigured(),
      dbAvailable: false,
    });
  }
  return NextResponse.json({
    ok: true,
    tournaments: list,
    dbConfigured: isDatabaseConfigured(),
    dbAvailable: true,
  });
}

/** Create a draft tournament — staff PIN required. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      format?: Parameters<typeof createTournament>[0]["format"];
      players?: Parameters<typeof createTournament>[0]["players"];
      staffPin?: string;
    };
    const denied = staffUnauthorized(readStaffPin(request, body));
    if (denied) return denied;
    if (!body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
    }
    const tournament = await createTournament({
      name: body.name,
      format: body.format,
      players: body.players,
    });
    return NextResponse.json({ ok: true, tournament }, { status: 201 });
  } catch (err) {
    if (err instanceof TournamentError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error("[tournaments] POST", err);
    return NextResponse.json({ ok: false, error: "Failed to create tournament" }, { status: 500 });
  }
}
