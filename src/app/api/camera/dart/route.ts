import { NextResponse } from "next/server";
import type { DartDetectedEvent, SegmentKind } from "@/engine/types";
import { applyCameraDart, checkCameraAuth } from "@/lib/server-game-store";

/**
 * POST /api/camera/dart
 * Body: { kind, number, matchId?, roomId?, angle?, radius?, confidence?, timestamp? }
 *
 * Phase 2 hook for computer-vision auto-detection software.
 */
export async function POST(request: Request) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Partial<DartDetectedEvent>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = body.kind as SegmentKind | undefined;
  if (!kind) {
    return NextResponse.json(
      { error: "kind is required (single|double|triple|outer_bull|bull|miss)" },
      { status: 400 }
    );
  }

  const number = typeof body.number === "number" ? body.number : 0;
  const result = applyCameraDart({
    kind,
    number,
    matchId: body.matchId,
    roomId: body.roomId,
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
    matchId: result.state.id,
    status: result.state.status,
    currentPlayerIndex: result.state.currentPlayerIndex,
    currentTurnDarts: result.state.currentTurnDarts,
    playerStates: result.state.playerStates,
    turnEnded: result.turnEnded,
    dartsThisTurn: result.state.currentTurnDarts.length,
  });
}
