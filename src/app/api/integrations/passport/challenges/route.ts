import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassportBearer } from "@/lib/auth/passport";
import { listActiveChallenges, upsertChallenge } from "@/lib/challenges/server";

const goalSchema = z.object({
  id: z.string().min(1),
  ruleType: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  points: z.number(),
  stack: z.enum(["once", "every"]).optional(),
});

const bodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  startsAt: z.union([z.number(), z.string()]),
  endsAt: z.union([z.number(), z.string()]),
  status: z.enum(["active", "closed"]).optional(),
  goals: z.array(goalSchema).min(1),
});

/**
 * Upsert an active challenge definition from No3Passport.
 *
 * Auth: `Authorization: Bearer $PASSPORT_DARTS_SHARED_SECRET`
 * Never logs the shared secret. No session cookies.
 */
export async function PUT(req: Request) {
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
    return NextResponse.json(
      { ok: false, error: "Invalid challenge payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await upsertChallenge(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, challenge: result.challenge });
}

/**
 * List challenges currently in their active window (Passport convenience).
 * Auth: Bearer shared secret.
 */
export async function GET(req: Request) {
  if (!verifyPassportBearer(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const active = await listActiveChallenges();
  return NextResponse.json({ ok: true, challenges: active });
}
