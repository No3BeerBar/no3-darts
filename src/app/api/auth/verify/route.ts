import { NextResponse } from "next/server";
import { z } from "zod";
import { loginPlayer } from "@/lib/players-server";

const bodySchema = z.object({
  name: z.string(),
  pin: z.string(),
});

/**
 * Check name+PIN without changing the tablet session cookie.
 * Used when adding another registered player to a match.
 */
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

  const result = await loginPlayer(parsed.data.name, parsed.data.pin);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, player: result.player });
}
