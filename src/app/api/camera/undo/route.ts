import { NextResponse } from "next/server";
import { applyCameraUndo, checkCameraAuth } from "@/lib/server-game-store";

/**
 * POST /api/camera/undo
 * Body: { matchId?, roomId? }
 *
 * Step backward one applied dart (camera or manual) on the server match.
 * Same engine path as patron Undo on /play — call repeatedly to walk history.
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

  const result = applyCameraUndo({
    matchId: body.matchId,
    roomId: body.roomId,
  });

  if (!result.ok) {
    const status = result.error === "Nothing to undo" ? 409 : 404;
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
    dartsThisTurn: result.state.currentTurnDarts.length,
    undone: true,
  });
}
