import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { registerPlayer } from "@/lib/players-server";

const bodySchema = z.object({
  name: z.string(),
  pin: z.string(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "name and pin required" }, { status: 400 });
  }

  const result = await registerPlayer(parsed.data.name, parsed.data.pin);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const res = NextResponse.json({ ok: true, player: result.player });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(result.player.id, result.player.name),
    sessionCookieOptions()
  );
  return res;
}
