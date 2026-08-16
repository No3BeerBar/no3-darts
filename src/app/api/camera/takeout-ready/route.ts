import { NextResponse } from "next/server";
import {
  consumeTakeoutReady,
  requestTakeoutReady,
} from "@/lib/server-game-store";

/**
 * POST /api/camera/takeout-ready
 * Body: { roomId? }
 *
 * Patron /play (or staff) acknowledges Autodarts takeout — "Ready for next visit".
 * Open to the kiosk (no camera API key); bridge consumes via GET.
 */
export async function POST(request: Request) {
  let body: { roomId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const roomId = (body.roomId || "Board 1").trim() || "Board 1";
  const result = requestTakeoutReady(roomId);
  return NextResponse.json({
    ok: true,
    pending: true,
    roomId: result.roomId,
    ts: result.ts,
    matchId: result.matchId,
    visitToken: result.visitToken,
  });
}

/**
 * GET /api/camera/takeout-ready?room=Board%201&consume=1
 * Companion bridge polls; consume=1 clears the pending ack.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const room = (searchParams.get("room") || "Board 1").trim() || "Board 1";
  const consume =
    searchParams.get("consume") === "1" ||
    searchParams.get("consume") === "true";
  const result = consumeTakeoutReady(room, consume);
  return NextResponse.json(
    {
      ok: true,
      pending: result.pending,
      ts: result.ts,
      roomId: result.roomId,
      matchId: result.matchId,
      visitToken: result.visitToken,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
