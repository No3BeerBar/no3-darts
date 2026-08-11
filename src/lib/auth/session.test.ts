import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, parseSessionToken } from "./session";

describe("session tokens", () => {
  const prev = process.env.SESSION_SECRET;

  afterEach(() => {
    if (prev === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prev;
  });

  it("round-trips a signed session", () => {
    process.env.SESSION_SECRET = "test-secret-for-session";
    const token = createSessionToken("player_abc", "Mike");
    const parsed = parseSessionToken(token);
    expect(parsed).toMatchObject({ playerId: "player_abc", name: "Mike" });
    expect(parsed!.exp).toBeGreaterThan(Date.now());
  });

  it("rejects tampered tokens", () => {
    process.env.SESSION_SECRET = "test-secret-for-session";
    const token = createSessionToken("player_abc", "Mike");
    const [body] = token.split(".");
    expect(parseSessionToken(`${body}.bogus-signature`)).toBeNull();
    expect(parseSessionToken("not-a-token")).toBeNull();
    expect(parseSessionToken(null)).toBeNull();
  });
});
