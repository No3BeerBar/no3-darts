import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tournament/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tournament/server")>();
  return { ...actual, assignMatchLane: vi.fn() };
});

import { DEFAULT_STAFF_PIN } from "@/lib/auth/staff-constants";
import { TournamentError, assignMatchLane } from "@/lib/tournament/server";
import { POST } from "./route";

const assignMock = vi.mocked(assignMatchLane);

function req(body: unknown) {
  return new Request("http://localhost/api/tournaments/t2/matches/m2/assign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "t2", matchId: "m2" }) };

describe("POST tournament match assign", () => {
  const prev = process.env.STAFF_PIN;

  beforeEach(() => {
    delete process.env.STAFF_PIN;
    assignMock.mockReset();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.STAFF_PIN;
    else process.env.STAFF_PIN = prev;
  });

  it("returns 409 when another tournament already holds the lane", async () => {
    assignMock.mockRejectedValue(
      new TournamentError("Board 1 is already assigned to another active match", 409)
    );

    const res = await POST(req({ lane: "Board 1", staffPin: DEFAULT_STAFF_PIN }), ctx);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: "Board 1 is already assigned to another active match",
    });
  });
});
