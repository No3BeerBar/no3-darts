import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PIN, getExpectedStaffPin, verifyStaffPin } from "./staff";

describe("staff PIN auth", () => {
  const prev = process.env.STAFF_PIN;

  afterEach(() => {
    if (prev === undefined) delete process.env.STAFF_PIN;
    else process.env.STAFF_PIN = prev;
  });

  it("defaults to 1234 when STAFF_PIN unset", () => {
    delete process.env.STAFF_PIN;
    expect(getExpectedStaffPin()).toBe(DEFAULT_STAFF_PIN);
    expect(verifyStaffPin("1234")).toBe(true);
    expect(verifyStaffPin("0000")).toBe(false);
  });

  it("uses STAFF_PIN when it is a 4-digit value", () => {
    process.env.STAFF_PIN = "9876";
    expect(getExpectedStaffPin()).toBe("9876");
    expect(verifyStaffPin("9876")).toBe(true);
    expect(verifyStaffPin("1234")).toBe(false);
  });

  it("ignores invalid STAFF_PIN and falls back to default", () => {
    process.env.STAFF_PIN = "99";
    expect(getExpectedStaffPin()).toBe(DEFAULT_STAFF_PIN);
  });

  it("rejects non-4-digit input without throwing", () => {
    delete process.env.STAFF_PIN;
    expect(verifyStaffPin("")).toBe(false);
    expect(verifyStaffPin("12")).toBe(false);
    expect(verifyStaffPin("abcd")).toBe(false);
  });
});
