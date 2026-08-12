import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/challenges/server", () => ({
  upsertChallenge: vi.fn(),
  listActiveChallenges: vi.fn(),
}));

import { GET, PUT } from "./route";
import { listActiveChallenges, upsertChallenge } from "@/lib/challenges/server";

const upsertMock = vi.mocked(upsertChallenge);
const listMock = vi.mocked(listActiveChallenges);

const SECRET = "passport-challenges-test-secret";
const URL = "http://localhost/api/integrations/passport/challenges";

function req(method: "PUT" | "GET", opts: { auth?: string | null; body?: unknown }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth) headers.authorization = opts.auth;
  return new Request(URL, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

const sampleBody = {
  id: "chal_week1",
  name: "Bull rush",
  startsAt: Date.UTC(2026, 7, 1),
  endsAt: Date.UTC(2026, 7, 31),
  status: "active" as const,
  goals: [
    {
      id: "g1",
      ruleType: "bull",
      params: { count: 3 },
      points: 10,
      stack: "every" as const,
    },
  ],
};

describe("Passport challenges integration", () => {
  const prev = process.env.PASSPORT_DARTS_SHARED_SECRET;

  beforeEach(() => {
    process.env.PASSPORT_DARTS_SHARED_SECRET = SECRET;
    upsertMock.mockReset();
    listMock.mockReset();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.PASSPORT_DARTS_SHARED_SECRET;
    else process.env.PASSPORT_DARTS_SHARED_SECRET = prev;
  });

  it("PUT returns 401 without valid Bearer", async () => {
    const res = await PUT(req("PUT", { auth: "Bearer nope", body: sampleBody }));
    expect(res.status).toBe(401);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("PUT upserts challenge on success without Set-Cookie", async () => {
    upsertMock.mockResolvedValue({
      ok: true,
      challenge: {
        id: "chal_week1",
        name: "Bull rush",
        startsAt: sampleBody.startsAt,
        endsAt: sampleBody.endsAt,
        status: "active",
        goals: [
          {
            id: "g1",
            ruleType: "bull",
            params: { count: 3 },
            points: 10,
            stack: "every",
          },
        ],
      },
    });

    const res = await PUT(req("PUT", { auth: `Bearer ${SECRET}`, body: sampleBody }));
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(sampleBody);
    expect(res.headers.get("set-cookie")).toBeNull();
    await expect(res.json()).resolves.toMatchObject({ ok: true, challenge: { id: "chal_week1" } });
  });

  it("GET active list requires Bearer", async () => {
    listMock.mockResolvedValue([]);
    expect((await GET(req("GET", { auth: null }))).status).toBe(401);
    const ok = await GET(req("GET", { auth: `Bearer ${SECRET}` }));
    expect(ok.status).toBe(200);
    expect(listMock).toHaveBeenCalled();
  });
});
