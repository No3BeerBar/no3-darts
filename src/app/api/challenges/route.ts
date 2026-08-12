import { NextResponse } from "next/server";
import { listActiveChallenges, listChallenges } from "@/lib/challenges/server";

/**
 * Public/staff-friendly challenge list for TV later.
 * Defaults to challenges in the active time window.
 * `?all=1` returns all non-closed (or with `?closed=1` includes closed).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const includeClosed = url.searchParams.get("closed") === "1";

  const challenges = all
    ? await listChallenges({ includeClosed })
    : await listActiveChallenges();

  return NextResponse.json({ ok: true, challenges });
}
