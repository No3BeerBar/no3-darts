import { NextResponse } from "next/server";
import { getDb, isDatabaseConfigured } from "@/db";

export async function GET() {
  const configured = isDatabaseConfigured();
  let dbOk = false;
  if (configured) {
    dbOk = (await getDb()) !== null;
  }
  return NextResponse.json({
    ok: true,
    service: "no3-darts",
    version: "0.1.0",
    ts: Date.now(),
    database: {
      configured,
      available: dbOk,
    },
  });
}
