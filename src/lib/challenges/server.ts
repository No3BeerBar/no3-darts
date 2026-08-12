/**
 * Timed challenges — Postgres persistence + Passport integration helpers.
 * Scoring runs at match persist from final GameState.turns (no board polling).
 */

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { createId } from "@/engine";
import { getDb, schema } from "@/db";
import type { StoredMatch } from "@/lib/storage";
import {
  evaluateChallengeGoals,
  sumCreditPoints,
  type ChallengeCredit,
  type ChallengeGoalDef,
  type ChallengeRuleType,
  type ChallengeStack,
} from "./rules";

const RULE_TYPES = new Set<ChallengeRuleType>([
  "bull",
  "checkout_min",
  "visit_score",
  "one_eighty",
  "segment_hit",
  "match_win",
  "legs_won",
]);

export type ChallengeStatus = "active" | "closed";

export type UpsertChallengeInput = {
  id: string;
  name: string;
  startsAt: number | string | Date;
  endsAt: number | string | Date;
  status?: ChallengeStatus;
  goals: Array<{
    id: string;
    ruleType: string;
    params?: Record<string, unknown>;
    points: number;
    stack?: ChallengeStack;
  }>;
};

export type ChallengePublic = {
  id: string;
  name: string;
  startsAt: number;
  endsAt: number;
  status: ChallengeStatus;
  goals: Array<{
    id: string;
    ruleType: string;
    params: Record<string, unknown>;
    points: number;
    stack: string;
  }>;
};

export type StandingRow = {
  rank: number;
  playerId: string;
  name: string;
  points: number;
  breakdown: unknown;
};

function toMs(v: number | string | Date): Date {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error("invalid_date");
  return d;
}

function goalDefsFromRows(
  rows: Array<{
    id: string;
    ruleType: string;
    paramsJson: unknown;
    points: number;
    stack: string;
  }>
): ChallengeGoalDef[] {
  return rows
    .filter((g) => RULE_TYPES.has(g.ruleType as ChallengeRuleType))
    .map((g) => ({
      id: g.id,
      ruleType: g.ruleType as ChallengeRuleType,
      params: (g.paramsJson && typeof g.paramsJson === "object"
        ? g.paramsJson
        : {}) as Record<string, unknown>,
      points: g.points,
      stack: g.stack === "once" ? "once" : "every",
    }));
}

function toPublic(
  ch: typeof schema.challenges.$inferSelect,
  goals: Array<typeof schema.challengeGoals.$inferSelect>
): ChallengePublic {
  return {
    id: ch.id,
    name: ch.name,
    startsAt: ch.startsAt.getTime(),
    endsAt: ch.endsAt.getTime(),
    status: ch.status === "closed" ? "closed" : "active",
    goals: goals
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({
        id: g.id,
        ruleType: g.ruleType,
        params: (g.paramsJson && typeof g.paramsJson === "object"
          ? g.paramsJson
          : {}) as Record<string, unknown>,
        points: g.points,
        stack: g.stack,
      })),
  };
}

export async function upsertChallenge(
  input: UpsertChallengeInput
): Promise<{ ok: true; challenge: ChallengePublic } | { ok: false; error: string; status: number }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "database_unavailable", status: 503 };

  if (!input.id?.trim() || !input.name?.trim()) {
    return { ok: false, error: "id and name required", status: 400 };
  }
  if (!Array.isArray(input.goals) || input.goals.length === 0) {
    return { ok: false, error: "goals required", status: 400 };
  }

  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = toMs(input.startsAt);
    endsAt = toMs(input.endsAt);
  } catch {
    return { ok: false, error: "invalid startsAt/endsAt", status: 400 };
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "endsAt must be after startsAt", status: 400 };
  }

  for (const g of input.goals) {
    if (!g.id?.trim()) return { ok: false, error: "goal id required", status: 400 };
    if (!RULE_TYPES.has(g.ruleType as ChallengeRuleType)) {
      return { ok: false, error: `unknown ruleType: ${g.ruleType}`, status: 400 };
    }
    if (typeof g.points !== "number" || !Number.isFinite(g.points)) {
      return { ok: false, error: "goal points must be a number", status: 400 };
    }
  }

  const status: ChallengeStatus = input.status === "closed" ? "closed" : "active";
  const now = new Date();

  try {
    const challenge = await db.transaction(async (tx) => {
      await tx
        .insert(schema.challenges)
        .values({
          id: input.id.trim(),
          name: input.name.trim(),
          startsAt,
          endsAt,
          status,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.challenges.id,
          set: {
            name: input.name.trim(),
            startsAt,
            endsAt,
            status,
            updatedAt: now,
          },
        });

      // Replace goals for this challenge (Passport is source of truth for defs)
      await tx
        .delete(schema.challengeGoals)
        .where(eq(schema.challengeGoals.challengeId, input.id.trim()));

      for (let i = 0; i < input.goals.length; i++) {
        const g = input.goals[i];
        await tx.insert(schema.challengeGoals).values({
          id: g.id.trim(),
          challengeId: input.id.trim(),
          ruleType: g.ruleType,
          paramsJson: g.params ?? {},
          points: Math.trunc(g.points),
          stack: g.stack === "once" ? "once" : "every",
          sortOrder: i,
        });
      }

      const ch = await tx.query.challenges.findFirst({
        where: eq(schema.challenges.id, input.id.trim()),
      });
      const goals = await tx.query.challengeGoals.findMany({
        where: eq(schema.challengeGoals.challengeId, input.id.trim()),
        orderBy: [asc(schema.challengeGoals.sortOrder)],
      });
      if (!ch) throw new Error("missing_challenge");
      return toPublic(ch, goals);
    });

    return { ok: true, challenge };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.warn("[no3-darts] upsertChallenge failed:", msg || err);
    return { ok: false, error: "upsert_failed", status: 500 };
  }
}

export async function listActiveChallenges(atMs = Date.now()): Promise<ChallengePublic[]> {
  const db = await getDb();
  if (!db) return [];

  const at = new Date(atMs);
  const rows = await db.query.challenges.findMany({
    where: and(
      eq(schema.challenges.status, "active"),
      lte(schema.challenges.startsAt, at),
      gte(schema.challenges.endsAt, at)
    ),
    orderBy: [asc(schema.challenges.startsAt)],
  });

  const out: ChallengePublic[] = [];
  for (const ch of rows) {
    const goals = await db.query.challengeGoals.findMany({
      where: eq(schema.challengeGoals.challengeId, ch.id),
      orderBy: [asc(schema.challengeGoals.sortOrder)],
    });
    out.push(toPublic(ch, goals));
  }
  return out;
}

export async function listChallenges(opts?: {
  includeClosed?: boolean;
}): Promise<ChallengePublic[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = opts?.includeClosed
    ? await db.query.challenges.findMany({ orderBy: [desc(schema.challenges.startsAt)] })
    : await db.query.challenges.findMany({
        where: eq(schema.challenges.status, "active"),
        orderBy: [desc(schema.challenges.startsAt)],
      });

  const out: ChallengePublic[] = [];
  for (const ch of rows) {
    const goals = await db.query.challengeGoals.findMany({
      where: eq(schema.challengeGoals.challengeId, ch.id),
      orderBy: [asc(schema.challengeGoals.sortOrder)],
    });
    out.push(toPublic(ch, goals));
  }
  return out;
}

export async function getChallenge(id: string): Promise<ChallengePublic | null> {
  const db = await getDb();
  if (!db) return null;
  const ch = await db.query.challenges.findFirst({
    where: eq(schema.challenges.id, id),
  });
  if (!ch) return null;
  const goals = await db.query.challengeGoals.findMany({
    where: eq(schema.challengeGoals.challengeId, ch.id),
    orderBy: [asc(schema.challengeGoals.sortOrder)],
  });
  return toPublic(ch, goals);
}

export async function getChallengeStandings(
  challengeId: string,
  limit = 50
): Promise<{
  challenge: ChallengePublic;
  standings: StandingRow[];
  winner: StandingRow | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const challenge = await getChallenge(challengeId);
  if (!challenge) return null;

  const rows = await db
    .select({
      playerId: schema.challengeProgress.playerId,
      points: schema.challengeProgress.points,
      breakdown: schema.challengeProgress.breakdownJson,
      name: schema.players.name,
    })
    .from(schema.challengeProgress)
    .innerJoin(schema.players, eq(schema.players.id, schema.challengeProgress.playerId))
    .where(eq(schema.challengeProgress.challengeId, challengeId))
    .orderBy(desc(schema.challengeProgress.points), asc(schema.players.name))
    .limit(Math.min(Math.max(limit, 1), 200));

  const standings: StandingRow[] = rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.playerId,
    name: r.name,
    points: r.points,
    breakdown: r.breakdown,
  }));

  return {
    challenge,
    standings,
    winner: standings[0] ?? null,
  };
}

export async function closeChallenge(challengeId: string): Promise<{
  ok: true;
  challenge: ChallengePublic;
  standings: StandingRow[];
  winner: StandingRow | null;
} | { ok: false; error: string; status: number }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "database_unavailable", status: 503 };

  const existing = await db.query.challenges.findFirst({
    where: eq(schema.challenges.id, challengeId),
  });
  if (!existing) return { ok: false, error: "not_found", status: 404 };

  await db
    .update(schema.challenges)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(schema.challenges.id, challengeId));

  const board = await getChallengeStandings(challengeId);
  if (!board) return { ok: false, error: "not_found", status: 404 };
  return { ok: true, ...board };
}

type BreakdownGoal = { goalId: string; points: number; occurrences: number };

function mergeBreakdown(
  prev: unknown,
  credits: ChallengeCredit[],
  matchId: string
): { goals: Record<string, BreakdownGoal>; matches: string[] } {
  const base =
    prev && typeof prev === "object"
      ? (prev as { goals?: Record<string, BreakdownGoal>; matches?: string[] })
      : {};
  const goals: Record<string, BreakdownGoal> = { ...(base.goals ?? {}) };
  for (const c of credits) {
    const cur = goals[c.goalId] ?? { goalId: c.goalId, points: 0, occurrences: 0 };
    goals[c.goalId] = {
      goalId: c.goalId,
      points: cur.points + c.points,
      occurrences: cur.occurrences + c.occurrences,
    };
  }
  const matches = Array.isArray(base.matches) ? [...base.matches] : [];
  if (!matches.includes(matchId)) matches.push(matchId);
  return { goals, matches };
}

/**
 * Score active challenges for a finished match (registered PIN players only).
 * Idempotent on (matchId, challengeId, playerId). Safe to call after persist
 * even when the match row already existed.
 */
export async function creditChallengesForMatch(match: StoredMatch): Promise<{
  credited: number;
  skipped: boolean;
}> {
  const db = await getDb();
  if (!db) return { credited: 0, skipped: true };

  const finishedAt = match.finishedAt;
  const at = new Date(finishedAt);

  // Active defs whose window contains finishedAt (closed challenges do not score)
  const active = await db.query.challenges.findMany({
    where: and(
      eq(schema.challenges.status, "active"),
      lte(schema.challenges.startsAt, at),
      gte(schema.challenges.endsAt, at)
    ),
  });
  if (active.length === 0) return { credited: 0, skipped: true };

  // Registered players only — guests/bots never score
  const registeredIds: string[] = [];
  for (const p of match.players) {
    if (p.isGuest === true) continue;
    const bot = match.state.players.find((x) => x.id === p.id)?.isBot;
    if (bot) continue;
    const row = await db.query.players.findFirst({
      where: eq(schema.players.id, p.id),
      columns: { id: true },
    });
    if (row) registeredIds.push(row.id);
  }
  if (registeredIds.length === 0) return { credited: 0, skipped: true };

  let credited = 0;

  for (const ch of active) {
    const goalRows = await db.query.challengeGoals.findMany({
      where: eq(schema.challengeGoals.challengeId, ch.id),
      orderBy: [asc(schema.challengeGoals.sortOrder)],
    });
    const goals = goalDefsFromRows(goalRows);
    if (goals.length === 0) continue;

    for (const playerId of registeredIds) {
      const credits = evaluateChallengeGoals(match.state, playerId, goals);
      const points = sumCreditPoints(credits);
      // Still record a zero-credit row for idempotency? Prefer only when points > 0
      // so empty matches don't spam. Idempotency: if we insert only when points>0,
      // a later retry with same eval is fine. If first attempt crashed after insert
      // but before progress update — use transaction.

      if (points <= 0 && credits.length === 0) continue;

      try {
        await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(schema.challengeMatchCredits)
            .values({
              id: createId("cmc"),
              matchId: match.id,
              challengeId: ch.id,
              playerId,
              points,
              creditsJson: credits,
            })
            .onConflictDoNothing()
            .returning({ id: schema.challengeMatchCredits.id });

          if (inserted.length === 0) return; // already credited this match

          const existing = await tx.query.challengeProgress.findFirst({
            where: and(
              eq(schema.challengeProgress.challengeId, ch.id),
              eq(schema.challengeProgress.playerId, playerId)
            ),
          });

          const breakdown = mergeBreakdown(existing?.breakdownJson, credits, match.id);

          if (existing) {
            await tx
              .update(schema.challengeProgress)
              .set({
                points: existing.points + points,
                breakdownJson: breakdown,
                updatedAt: new Date(),
              })
              .where(eq(schema.challengeProgress.id, existing.id));
          } else {
            await tx.insert(schema.challengeProgress).values({
              id: createId("cprog"),
              challengeId: ch.id,
              playerId,
              points,
              breakdownJson: breakdown,
              updatedAt: new Date(),
            });
          }
          credited += 1;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("duplicate") || msg.includes("unique")) continue;
        console.warn("[no3-darts] challenge credit failed:", msg || err);
      }
    }
  }

  return { credited, skipped: false };
}

/** Test helper: expose window check without DB. */
export function challengeWindowContains(
  startsAt: number,
  endsAt: number,
  finishedAt: number
): boolean {
  return finishedAt >= startsAt && finishedAt <= endsAt;
}
