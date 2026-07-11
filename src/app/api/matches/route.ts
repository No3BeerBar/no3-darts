import { NextResponse } from "next/server";
import { createGame, type CreateGameOptions } from "@/engine";
import {
  checkCameraAuth,
  listServerMatches,
  upsertServerMatch,
} from "@/lib/server-game-store";

/** GET /api/matches – list server-registered matches */
export async function GET(request: Request) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ matches: listServerMatches() });
}

/** POST /api/matches – create / register a match on the server (for camera) */
export async function POST(request: Request) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Either full state sync from client, or create options
    if (body.state) {
      upsertServerMatch(body.state);
      return NextResponse.json({ ok: true, match: body.state });
    }

    const opts = body as CreateGameOptions;
    if (!opts.modeConfig || !opts.players?.length) {
      return NextResponse.json(
        { error: "modeConfig and players required" },
        { status: 400 }
      );
    }
    const state = createGame(opts);
    upsertServerMatch(state);
    return NextResponse.json({ ok: true, match: state }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bad request" },
      { status: 400 }
    );
  }
}
