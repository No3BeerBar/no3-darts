import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassportBearer } from "@/lib/auth/passport";
import { loginPlayer } from "@/lib/players-server";

const bodySchema = z.object({
  name: z.string(),
  pin: z.string(),
});

/**
 * No3Passport link challenge: verify darts name+PIN without touching tablet session cookies.
 *
 * Auth: `Authorization: Bearer $PASSPORT_DARTS_SHARED_SECRET` (required; 401 if missing/wrong).
 * Body/PIN semantics match `POST /api/auth/verify` (reuse loginPlayer lockout).
 * Never logs the PIN or shared secret.
 */
export async function POST(req: Request) {
  if (!verifyPassportBearer(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

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

  // Explicitly no Set-Cookie — Passport linking must not alter bartender/board tablet sessions.
  return NextResponse.json({ ok: true, player: result.player });
}
