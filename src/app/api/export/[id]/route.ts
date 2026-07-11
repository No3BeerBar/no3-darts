import { NextResponse } from "next/server";
import { getServerMatch } from "@/lib/server-game-store";
import { buildStoredMatch } from "@/lib/match-export";
import { matchToCsv } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/export/:id?format=json|csv – export server match */
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const match = getServerMatch(id);
  if (!match) {
    return NextResponse.json(
      {
        error: "Match not on server. Client-side history is in the browser; use History page export.",
      },
      { status: 404 }
    );
  }

  const stored = buildStoredMatch(match);
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "json";

  if (format === "csv") {
    return new NextResponse(matchToCsv(stored), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="match-${id}.csv"`,
      },
    });
  }

  return NextResponse.json(stored);
}
