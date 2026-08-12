import { timingSafeEqual } from "crypto";

/**
 * Shared secret for No3Passport → No3 Darts service-to-service calls.
 * Required on the no3-darts service; missing/empty secret rejects all requests.
 */
export function getPassportSharedSecret(): string | null {
  const secret = process.env.PASSPORT_DARTS_SHARED_SECRET?.trim();
  return secret || null;
}

/**
 * Verify `Authorization: Bearer $PASSPORT_DARTS_SHARED_SECRET`.
 * Returns false when the env secret is missing, the header is absent/malformed, or the token mismatches.
 * Uses a constant-time compare when lengths match. Never logs the secret or token.
 */
export function verifyPassportBearer(request: Request): boolean {
  const secret = getPassportSharedSecret();
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length);
  if (!token) return false;

  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
