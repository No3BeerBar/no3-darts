import bcrypt from "bcryptjs";

const PIN_RE = /^\d{4}$/;
const BCRYPT_ROUNDS = 10;

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function normalizeNameKey(raw: string): string {
  return normalizeDisplayName(raw).toLowerCase();
}

export function validateDisplayName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizeDisplayName(raw);
  if (name.length < 2 || name.length > 24) {
    return { ok: false, error: "Name must be 2–24 characters" };
  }
  return { ok: true, name };
}

export function validatePin(pin: string): { ok: true } | { ok: false; error: string } {
  if (!PIN_RE.test(pin)) {
    return { ok: false, error: "PIN must be exactly 4 digits" };
  }
  return { ok: true };
}

export async function hashPin(pin: string): Promise<string> {
  const check = validatePin(pin);
  if (!check.ok) throw new Error(check.error);
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  if (!PIN_RE.test(pin)) return false;
  return bcrypt.compare(pin, pinHash);
}
