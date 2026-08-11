import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/db";
import { getLaneOverview } from "@/lib/tournament/server";

/** Admin/TV overview of Board 1–3 + assigned tournament matches. */
export async function GET() {
  const lanes = await getLaneOverview();
  if (lanes === null) {
    return NextResponse.json({
      ok: true,
      lanes: [],
      dbConfigured: isDatabaseConfigured(),
      dbAvailable: false,
    });
  }
  return NextResponse.json({
    ok: true,
    lanes,
    dbConfigured: isDatabaseConfigured(),
    dbAvailable: true,
  });
}
