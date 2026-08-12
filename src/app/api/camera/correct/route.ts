import { NextResponse } from "next/server";
import type { SegmentKind } from "@/engine/types";
import {
  applyCameraCorrect,
  checkCameraAuth,
  type CameraCorrectDart,
} from "@/lib/server-game-store";

const KINDS = new Set<SegmentKind>([
  "single",
  "double",
  "triple",
  "outer_bull",
  "bull",
  "miss",
]);

/**
 * POST /api/camera/correct
 * Body: { roomId?, matchId?, darts: [{ kind, number, ... }], reason? }
 *
 * Replaces the open visit with the exact dart list (Autodarts-style correction).
 * Prefer this over undo + re-post so scoring stays idempotent.
 */
export async function POST(request: Request) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    roomId?: string;
    matchId?: string;
    darts?: CameraCorrectDart[];
    reason?: string;
    expectedPlayerIndex?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.darts)) {
    return NextResponse.json(
      { error: "darts array is required (may be empty to clear the visit)" },
      { status: 400 }
    );
  }

  const darts: CameraCorrectDart[] = [];
  for (const raw of body.darts.slice(0, 3)) {
    const kind = raw?.kind as SegmentKind | undefined;
    if (!kind || !KINDS.has(kind)) {
      return NextResponse.json(
        {
          error:
            "each dart needs kind (single|double|triple|outer_bull|bull|miss)",
        },
        { status: 400 }
      );
    }
    darts.push({
      kind,
      number: typeof raw.number === "number" ? raw.number : 0,
      angle: raw.angle,
      radius: raw.radius,
      confidence: raw.confidence,
      timestamp: raw.timestamp,
    });
  }

  const result = applyCameraCorrect({
    matchId: body.matchId,
    roomId: body.roomId,
    darts,
    reason: body.reason,
    expectedPlayerIndex:
      typeof body.expectedPlayerIndex === "number"
        ? body.expectedPlayerIndex
        : undefined,
  });

  if (!result.ok) {
    const status =
      /seat mismatch|expectedPlayerIndex|takeout hold|no open visit/i.test(
        result.error
      )
        ? 409
        : 404;
    return NextResponse.json({ error: result.error }, { status });
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
    corrected: true,
  });
}
