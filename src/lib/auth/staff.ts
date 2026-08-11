import { timingSafeEqual } from "crypto";
import { DEFAULT_STAFF_PIN } from "@/lib/auth/staff-constants";

export { DEFAULT_STAFF_PIN };

/**
 * Server-side staff PIN for privileged Admin APIs (e.g. player PIN reset).
 * Set STAFF_PIN on the Railway no3-darts service to match Admin → Staff PIN.
 */
export function getExpectedStaffPin(): string {
  const fromEnv = process.env.STAFF_PIN?.trim();
  if (fromEnv && /^\d{4}$/.test(fromEnv)) return fromEnv;
  return DEFAULT_STAFF_PIN;
}

/** Constant-time compare of two 4-digit staff PINs. Never logs the PIN. */
export function verifyStaffPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) return false;
  const expected = getExpectedStaffPin();
  const a = Buffer.from(pin, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
