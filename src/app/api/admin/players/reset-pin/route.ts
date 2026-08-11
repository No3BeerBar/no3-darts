import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffPin } from "@/lib/auth/staff";
import { resetPlayerPin } from "@/lib/players-server";

const bodySchema = z.object({
  playerId: z.string().min(1),
  newPin: z.string(),
  staffPin: z.string(),
});

/**
 * Staff-only: set a new temporary PIN for a registered player.
 * Requires staffPin matching STAFF_PIN env (default 1234).
 * Response never includes PIN hashes or the plaintext new PIN.
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
    return NextResponse.json(
      { ok: false, error: "playerId, newPin, and staffPin required" },
      { status: 400 }
    );
  }

  if (!verifyStaffPin(parsed.data.staffPin)) {
    return NextResponse.json({ ok: false, error: "Staff PIN incorrect" }, { status: 401 });
  }

  const result = await resetPlayerPin(parsed.data.playerId, parsed.data.newPin);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, player: result.player });
}
