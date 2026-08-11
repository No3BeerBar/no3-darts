import { NextResponse } from "next/server";
import { z } from "zod";
import { persistFinishedMatch } from "@/lib/players-server";
import type { StoredMatch } from "@/lib/storage";

const persistSchema = z.object({
  id: z.string().min(1),
  finishedAt: z.number(),
  mode: z.string(),
  modeLabel: z.string(),
  players: z.array(z.object({ id: z.string(), name: z.string() })),
  winnerId: z.string().nullable(),
  winnerName: z.string().nullable(),
  state: z.any(),
  summary: z.object({
    legs: z.number(),
    sets: z.number(),
    playerStats: z.array(
      z.object({
        playerId: z.string(),
        name: z.string(),
        avg: z.number(),
        oneEighties: z.number(),
        checkouts: z.number(),
        highestCheckout: z.number(),
        finalScore: z.number().optional(),
      })
    ),
  }),
});

/** Persist a finished match + update aggregates for registered players only. */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = persistSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid match payload" }, { status: 400 });
  }

  const result = await persistFinishedMatch(parsed.data as StoredMatch);
  if (!result.ok) {
    // Soft-fail: clients keep localStorage stats when DB is down
    return NextResponse.json(
      { ok: false, error: result.error ?? "persist_failed", degraded: true },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    updatedPlayerIds: result.updatedPlayerIds ?? [],
  });
}
