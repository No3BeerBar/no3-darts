import { afterEach, describe, expect, it } from "vitest";
import { getPassportSharedSecret, verifyPassportBearer } from "./passport";

describe("passport shared secret auth", () => {
  const prev = process.env.PASSPORT_DARTS_SHARED_SECRET;

  afterEach(() => {
    if (prev === undefined) delete process.env.PASSPORT_DARTS_SHARED_SECRET;
    else process.env.PASSPORT_DARTS_SHARED_SECRET = prev;
  });

  it("rejects when PASSPORT_DARTS_SHARED_SECRET is unset", () => {
    delete process.env.PASSPORT_DARTS_SHARED_SECRET;
    expect(getPassportSharedSecret()).toBeNull();
    const req = new Request("http://localhost/api", {
      headers: { authorization: "Bearer anything" },
    });
    expect(verifyPassportBearer(req)).toBe(false);
  });

  it("rejects missing or non-Bearer Authorization", () => {
    process.env.PASSPORT_DARTS_SHARED_SECRET = "passport-test-secret";
    expect(verifyPassportBearer(new Request("http://localhost/api"))).toBe(false);
    expect(
      verifyPassportBearer(
        new Request("http://localhost/api", {
          headers: { authorization: "passport-test-secret" },
        })
      )
    ).toBe(false);
    expect(
      verifyPassportBearer(
        new Request("http://localhost/api", {
          headers: { authorization: "Bearer " },
        })
      )
    ).toBe(false);
  });

  it("accepts the matching Bearer token", () => {
    process.env.PASSPORT_DARTS_SHARED_SECRET = "passport-test-secret";
    const req = new Request("http://localhost/api", {
      headers: { authorization: "Bearer passport-test-secret" },
    });
    expect(verifyPassportBearer(req)).toBe(true);
  });

  it("rejects a wrong Bearer token", () => {
    process.env.PASSPORT_DARTS_SHARED_SECRET = "passport-test-secret";
    const req = new Request("http://localhost/api", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    expect(verifyPassportBearer(req)).toBe(false);
  });
});
