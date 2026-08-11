"use client";

import { DEFAULT_STAFF_PIN } from "@/lib/auth/staff-constants";

/** Staff-gated tournament mutations — sends local Admin Staff PIN (must match STAFF_PIN). */
export async function tournamentStaffFetch(
  input: string,
  init: RequestInit & { staffPin?: string } = {}
): Promise<Response> {
  const pin = (init.staffPin || DEFAULT_STAFF_PIN).trim();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Staff-Pin", pin);

  let body = init.body;
  if (body && typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed.staffPin == null) {
        body = JSON.stringify({ ...parsed, staffPin: pin });
      }
    } catch {
      /* leave body as-is */
    }
  } else if (!body && (init.method === "POST" || init.method === "PATCH")) {
    body = JSON.stringify({ staffPin: pin });
  }

  const { staffPin: _omit, ...rest } = init;
  return fetch(input, { ...rest, headers, body });
}
