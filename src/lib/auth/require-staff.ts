import { NextResponse } from "next/server";
import { verifyStaffPin } from "@/lib/auth/staff";

/**
 * Extract staff PIN from JSON body (`staffPin`) or `X-Staff-Pin` header.
 * Returns null when missing / wrong — caller should return 401.
 */
export function readStaffPin(request: Request, body: unknown): string | null {
  const header = request.headers.get("x-staff-pin")?.trim();
  if (header && /^\d{4}$/.test(header)) return header;
  if (body && typeof body === "object" && body !== null && "staffPin" in body) {
    const pin = (body as { staffPin?: unknown }).staffPin;
    if (typeof pin === "string" && /^\d{4}$/.test(pin.trim())) return pin.trim();
  }
  return null;
}

/** 401 JSON when staff PIN missing or incorrect. */
export function staffUnauthorized(pin: string | null): NextResponse | null {
  if (!pin || !verifyStaffPin(pin)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Staff PIN incorrect — match Admin → Staff PIN with Railway STAFF_PIN (default 1234)",
      },
      { status: 401 }
    );
  }
  return null;
}
