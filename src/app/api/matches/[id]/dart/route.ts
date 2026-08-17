import { NextResponse } from "next/server";
import type { SegmentKind } from "@/engine/types";
import {
  applyCameraDart,
  checkCameraAuth,
  getServerMatch,
} from "@/lib/server-game-store";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/matches/:id/dart – apply dart to a specific match */
export async function POST(request: Request, ctx: Ctx) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = await request.json();
  const kind = body.kind as SegmentKind | undefined;
  if (!kind) {
    return NextResponse.json({ error: "kind required" }, { status: 400 });
  }

  // Honor a client-supplied seat. When omitted, the match id in the URL is
  // enough for the bartender / API path — bind to the current thrower so
  // dart 2/3 of the same visit still score after markVisitOpen.
  const expectedPlayerIndex =
    typeof body.expectedPlayerIndex === "number"
      ? body.expectedPlayerIndex
      : getServerMatch(id)?.currentPlayerIndex;

  const result = applyCameraDart({
    matchId: id,
    kind,
    number: body.number ?? 0,
    angle: body.angle,
    radius: body.radius,
    confidence: body.confidence,
    timestamp: body.timestamp ?? Date.now(),
    expectedPlayerIndex,
  });

  if (!result.ok) {
    const status =
      /seat mismatch|expectedPlayerIndex|takeout hold|takeout active/i.test(
        result.error
      )
        ? 409
        : 404;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    callout: result.callout,
    match: result.state,
  });
}
