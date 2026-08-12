import { NextResponse } from "next/server";
import type { CameraHealth } from "@/lib/camera-health";
import {
  checkCameraAuth,
  getCameraHealth,
  setCameraHealth,
} from "@/lib/server-game-store";

/**
 * GET /api/camera/health?room=Board%201
 * Latest Board Manager / camera health reported by the companion bridge.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const room = searchParams.get("room") || undefined;
  const health = getCameraHealth(room || undefined);
  if (!health) {
    return NextResponse.json({
      ok: true,
      health: null,
      message: "No health report yet",
    });
  }
  return NextResponse.json({ ok: true, health });
}

/**
 * POST /api/camera/health
 * Body from companion bridge — fans out via SSE `camera_health` for toasts.
 */
export async function POST(request: Request) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Partial<CameraHealth>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const roomId = (body.roomId || "Board 1").trim() || "Board 1";
  const health = setCameraHealth({
    roomId,
    ok: Boolean(body.ok),
    level: body.level || (body.ok ? "ok" : "unhealthy"),
    message: body.message || (body.ok ? "Cameras healthy" : "Cameras unhealthy"),
    reason: body.reason,
    fps: body.fps,
    minFps: body.minFps,
    cameras: body.cameras,
    connected: body.connected,
    status: body.status,
    unhealthyForS: body.unhealthyForS,
    restarting: body.restarting,
    takeout: Boolean(body.takeout) || body.level === "takeout" || body.reason === "takeout",
    ts: typeof body.ts === "number" ? body.ts : Date.now(),
  });

  return NextResponse.json({ ok: true, health });
}
