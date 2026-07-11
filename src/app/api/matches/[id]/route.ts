import { NextResponse } from "next/server";
import {
  checkCameraAuth,
  getServerMatch,
  removeServerMatch,
  upsertServerMatch,
} from "@/lib/server-game-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const match = getServerMatch(id);
  if (!match) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ match });
}

export async function PUT(request: Request, ctx: Ctx) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await request.json();
  if (!body.state || body.state.id !== id) {
    return NextResponse.json({ error: "state.id must match" }, { status: 400 });
  }
  upsertServerMatch(body.state);
  return NextResponse.json({ ok: true, match: body.state });
}

export async function DELETE(request: Request, ctx: Ctx) {
  if (!checkCameraAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  removeServerMatch(id);
  return NextResponse.json({ ok: true });
}
