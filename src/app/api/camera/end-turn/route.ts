import { NextResponse } from "next/server";
import { applyCameraEndTurn, checkCameraAuth } from "@/lib/server-game-store";

/**
 * POST /api/camera/end-turn
 * Body: { matchId?, roomId? }
 *
 * Detector calls this when hands pull darts (takeout) mid-visit
 * or after waiting for the board to clear.
 */
export async function POST(request: Request) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { matchId?: string; roomId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = applyCameraEndTurn({
    matchId: body.matchId,
    roomId: body.roomId,
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
  });
}
