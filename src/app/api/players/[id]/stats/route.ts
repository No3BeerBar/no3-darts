import { NextResponse } from "next/server";
import { getPlayerMatchHistory, getPublicPlayer } from "@/lib/players-server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const player = await getPublicPlayer(id);
  if (!player) {
    return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
  }
  const history = await getPlayerMatchHistory(id);
  return NextResponse.json({
    ok: true,
    player,
    history: history ?? [],
  });
}
