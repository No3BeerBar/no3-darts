import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/players-server", () => ({
  loginPlayer: vi.fn(),
}));

import { POST } from "./route";
import { loginPlayer } from "@/lib/players-server";

const loginPlayerMock = vi.mocked(loginPlayer);

const SECRET = "passport-route-test-secret";
const URL = "http://localhost/api/integrations/passport/link-challenge";

function req(opts: { auth?: string | null; body?: unknown }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth) headers.authorization = opts.auth;
  return new Request(URL, {
    method: "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

describe("POST /api/integrations/passport/link-challenge", () => {
  const prev = process.env.PASSPORT_DARTS_SHARED_SECRET;

  beforeEach(() => {
    process.env.PASSPORT_DARTS_SHARED_SECRET = SECRET;
    loginPlayerMock.mockReset();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.PASSPORT_DARTS_SHARED_SECRET;
    else process.env.PASSPORT_DARTS_SHARED_SECRET = prev;
  });

  it("returns 401 when shared secret env is missing", async () => {
    delete process.env.PASSPORT_DARTS_SHARED_SECRET;
    const res = await POST(req({ auth: `Bearer ${SECRET}`, body: { name: "Mike", pin: "1234" } }));
    expect(res.status).toBe(401);
    expect(loginPlayerMock).not.toHaveBeenCalled();
  });

  it("returns 401 for wrong Bearer token without calling loginPlayer", async () => {
    const res = await POST(req({ auth: "Bearer nope", body: { name: "Mike", pin: "1234" } }));
    expect(res.status).toBe(401);
    expect(loginPlayerMock).not.toHaveBeenCalled();
  });

  it("returns player identity without Set-Cookie on success", async () => {
    loginPlayerMock.mockResolvedValue({
      ok: true,
      player: {
        id: "player_1",
        name: "Mike",
        createdAt: 1_700_000_000_000,
        stats: {
          matchesPlayed: 3,
          matchesWon: 1,
          legsWon: 2,
          dartsThrown: 90,
          totalScore: 2400,
          oneEighties: 0,
          checkoutsHit: 1,
          checkoutAttempts: 4,
          highestCheckout: 80,
          bestThreeDartAvg: 55.5,
        },
      },
    });

    const res = await POST(
      req({ auth: `Bearer ${SECRET}`, body: { name: "Mike", pin: "4821" } })
    );
    expect(res.status).toBe(200);
    expect(loginPlayerMock).toHaveBeenCalledWith("Mike", "4821");
    await expect(res.json()).resolves.toEqual({
      ok: true,
      player: expect.objectContaining({
        id: "player_1",
        name: "Mike",
        stats: expect.objectContaining({ matchesPlayed: 3, bestThreeDartAvg: 55.5 }),
      }),
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("forwards loginPlayer auth failures (same semantics as /api/auth/verify)", async () => {
    loginPlayerMock.mockResolvedValue({
      ok: false,
      error: "Name or PIN incorrect",
      status: 401,
    });
    const res = await POST(
      req({ auth: `Bearer ${SECRET}`, body: { name: "Mike", pin: "0000" } })
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "Name or PIN incorrect",
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects invalid JSON / missing fields", async () => {
    const badJson = new Request(URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
      },
      body: "{",
    });
    expect((await POST(badJson)).status).toBe(400);

    const missing = await POST(req({ auth: `Bearer ${SECRET}`, body: { name: "Mike" } }));
    expect(missing.status).toBe(400);
    expect(loginPlayerMock).not.toHaveBeenCalled();
  });
});
