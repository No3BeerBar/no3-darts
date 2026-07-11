import { NextResponse } from "next/server";
import type { SegmentKind } from "@/engine/types";
import { applyCameraDart, checkCameraAuth } from "@/lib/server-game-store";

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

  const result = applyCameraDart({
    matchId: id,
    kind,
    number: body.number ?? 0,
    angle: body.angle,
    radius: body.radius,
    confidence: body.confidence,
    timestamp: body.timestamp ?? Date.now(),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    callout: result.callout,
    match: result.state,
  });
}
