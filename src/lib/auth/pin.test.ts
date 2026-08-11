import { describe, expect, it } from "vitest";
import {
  hashPin,
  normalizeNameKey,
  validateDisplayName,
  validatePin,
  verifyPin,
} from "./pin";

describe("validatePin", () => {
  it("accepts exactly 4 digits", () => {
    expect(validatePin("1234")).toEqual({ ok: true });
    expect(validatePin("0000")).toEqual({ ok: true });
  });

  it("rejects non-4-digit PINs", () => {
    expect(validatePin("123").ok).toBe(false);
    expect(validatePin("12345").ok).toBe(false);
    expect(validatePin("12a4").ok).toBe(false);
    expect(validatePin("").ok).toBe(false);
  });
});

describe("validateDisplayName / uniqueness key", () => {
  it("trims and enforces 2–24 length", () => {
    expect(validateDisplayName("  Ab  ")).toEqual({ ok: true, name: "Ab" });
    expect(validateDisplayName("A").ok).toBe(false);
    expect(validateDisplayName("x".repeat(25)).ok).toBe(false);
  });

  it("normalizes case for uniqueness", () => {
    expect(normalizeNameKey("  Mike  ")).toBe("mike");
    expect(normalizeNameKey("MIKE")).toBe("mike");
    expect(normalizeNameKey("Mike")).toBe(normalizeNameKey("mike"));
  });
});

describe("hashPin / verifyPin", () => {
  it("hashes and verifies a PIN", async () => {
    const hash = await hashPin("4821");
    expect(hash).not.toContain("4821");
    expect(await verifyPin("4821", hash)).toBe(true);
    expect(await verifyPin("4822", hash)).toBe(false);
  });

  it("rejects invalid PIN before hashing", async () => {
    await expect(hashPin("99")).rejects.toThrow(/4 digits/);
  });
});
