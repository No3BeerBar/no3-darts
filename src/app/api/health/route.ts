import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "no3-darts",
    version: "0.1.0",
    ts: Date.now(),
  });
}
