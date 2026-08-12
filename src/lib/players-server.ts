import { and, desc, eq, gte } from "drizzle-orm";
import { createId } from "@/engine";
import { getDb, schema } from "@/db";
import type { DbPlayer } from "@/db/schema";
import { hashPin, normalizeNameKey, validateDisplayName, validatePin, verifyPin } from "@/lib/auth/pin";
import { creditChallengesForMatch } from "@/lib/challenges/server";
import type { PlayerAggregateStats, StoredMatch } from "@/lib/storage";

const MAX_FAILED = 5;
const LOCKOUT_MS = 60_000;

export type PublicPlayer = {
  id: string;
  name: string;
  createdAt: number;
  stats: PlayerAggregateStats;
};

export type AuthResult =
  | { ok: true; player: PublicPlayer }
  | { ok: false; error: string; status: number };

function toPublic(p: DbPlayer): PublicPlayer {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt.getTime(),
    stats: {
      matchesPlayed: p.matchesPlayed,
      matchesWon: p.matchesWon,
      legsWon: p.legsWon,
      dartsThrown: p.dartsThrown,
      totalScore: p.totalScore,
      oneEighties: p.oneEighties,
      checkoutsHit: p.checkoutsHit,
      checkoutAttempts: p.checkoutAttempts,
      highestCheckout: p.highestCheckout,
      bestThreeDartAvg: p.bestThreeDartAvg,
    },
  };
}

function isLocked(p: DbPlayer): boolean {
  return Boolean(p.lockedUntil && p.lockedUntil.getTime() > Date.now());
}

export async function registerPlayer(rawName: string, pin: string): Promise<AuthResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Player accounts need Postgres (DATABASE_URL)", status: 503 };

  const nameCheck = validateDisplayName(rawName);
  if (!nameCheck.ok) return { ok: false, error: nameCheck.error, status: 400 };
  const pinCheck = validatePin(pin);
  if (!pinCheck.ok) return { ok: false, error: pinCheck.error, status: 400 };

  const nameNormalized = normalizeNameKey(nameCheck.name);
  const existing = await db.query.players.findFirst({
    where: eq(schema.players.nameNormalized, nameNormalized),
  });
  if (existing) {
    return { ok: false, error: "That name is already taken", status: 409 };
  }

  const id = createId("player");
  const pinHash = await hashPin(pin);
  try {
    const [row] = await db
      .insert(schema.players)
      .values({
        id,
        name: nameCheck.name,
        nameNormalized,
        pinHash,
      })
      .returning();
    return { ok: true, player: toPublic(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("players_name_normalized") || msg.includes("unique")) {
      return { ok: false, error: "That name is already taken", status: 409 };
    }
    throw err;
  }
}

export async function loginPlayer(rawName: string, pin: string): Promise<AuthResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Player accounts need Postgres (DATABASE_URL)", status: 503 };

  const nameCheck = validateDisplayName(rawName);
  if (!nameCheck.ok) return { ok: false, error: nameCheck.error, status: 400 };
  const pinCheck = validatePin(pin);
  if (!pinCheck.ok) return { ok: false, error: pinCheck.error, status: 400 };

  const player = await db.query.players.findFirst({
    where: eq(schema.players.nameNormalized, normalizeNameKey(nameCheck.name)),
  });
  if (!player) {
    return { ok: false, error: "Name or PIN incorrect", status: 401 };
  }

  if (isLocked(player)) {
    const secs = Math.ceil((player.lockedUntil!.getTime() - Date.now()) / 1000);
    return { ok: false, error: `Too many attempts — try again in ${secs}s`, status: 429 };
  }

  const good = await verifyPin(pin, player.pinHash);
  if (!good) {
    const failed = player.failedPinAttempts + 1;
    const lockedUntil = failed >= MAX_FAILED ? new Date(Date.now() + LOCKOUT_MS) : null;
    await db
      .update(schema.players)
      .set({
        failedPinAttempts: failed >= MAX_FAILED ? 0 : failed,
        lockedUntil,
      })
      .where(eq(schema.players.id, player.id));
    if (lockedUntil) {
      return { ok: false, error: "Too many attempts — locked for 60s", status: 429 };
    }
    return { ok: false, error: "Name or PIN incorrect", status: 401 };
  }

  if (player.failedPinAttempts > 0 || player.lockedUntil) {
    await db
      .update(schema.players)
      .set({ failedPinAttempts: 0, lockedUntil: null })
      .where(eq(schema.players.id, player.id));
  }

  return { ok: true, player: toPublic(player) };
}

export async function listPublicPlayers(): Promise<PublicPlayer[] | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(schema.players).orderBy(schema.players.name);
  return rows.map(toPublic);
}

export async function getPublicPlayer(id: string): Promise<PublicPlayer | null> {
  const db = await getDb();
  if (!db) return null;
  const row = await db.query.players.findFirst({ where: eq(schema.players.id, id) });
  return row ? toPublic(row) : null;
}

/**
 * Staff reset of a registered player's PIN.
 * Overwrites pin_hash and clears lockout. Callers must authorize as staff first.
 * Never logs or returns the plaintext PIN.
 */
export async function resetPlayerPin(
  playerId: string,
  newPin: string
): Promise<AuthResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Player accounts need Postgres (DATABASE_URL)", status: 503 };

  const pinCheck = validatePin(newPin);
  if (!pinCheck.ok) return { ok: false, error: pinCheck.error, status: 400 };

  const id = playerId.trim();
  if (!id) return { ok: false, error: "Player required", status: 400 };

  const player = await db.query.players.findFirst({
    where: eq(schema.players.id, id),
  });
  if (!player) {
    return { ok: false, error: "Player not found", status: 404 };
  }

  const pinHash = await hashPin(newPin);
  const [row] = await db
    .update(schema.players)
    .set({
      pinHash,
      failedPinAttempts: 0,
      lockedUntil: null,
    })
    .where(eq(schema.players.id, player.id))
    .returning();

  return { ok: true, player: toPublic(row) };
}

export async function getPlayerMatchHistory(playerId: string, limit = 50) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select({
      matchId: schema.matches.id,
      finishedAt: schema.matches.finishedAt,
      mode: schema.matches.mode,
      modeLabel: schema.matches.modeLabel,
      winnerPlayerId: schema.matches.winnerPlayerId,
      winnerName: schema.matches.winnerName,
      avg: schema.matchPlayers.avg,
      oneEighties: schema.matchPlayers.oneEighties,
      checkouts: schema.matchPlayers.checkouts,
      highestCheckout: schema.matchPlayers.highestCheckout,
    })
    .from(schema.matchPlayers)
    .innerJoin(schema.matches, eq(schema.matchPlayers.matchId, schema.matches.id))
    .where(eq(schema.matchPlayers.playerId, playerId))
    .orderBy(desc(schema.matches.finishedAt))
    .limit(limit);

  return rows.map((r) => ({
    matchId: r.matchId,
    finishedAt: r.finishedAt.getTime(),
    mode: r.mode,
    modeLabel: r.modeLabel,
    winnerPlayerId: r.winnerPlayerId,
    winnerName: r.winnerName,
    won: r.winnerPlayerId === playerId,
    avg: r.avg,
    oneEighties: r.oneEighties,
    checkouts: r.checkouts,
    highestCheckout: r.highestCheckout,
  }));
}

/** Weekly-board helper: finished matches in a time window for a player. */
export async function getPlayerMatchesSince(playerId: string, sinceMs: number) {
  const db = await getDb();
  if (!db) return null;
  const since = new Date(sinceMs);
  return db
    .select({
      matchId: schema.matches.id,
      finishedAt: schema.matches.finishedAt,
      playerId: schema.matchPlayers.playerId,
      name: schema.matchPlayers.name,
      avg: schema.matchPlayers.avg,
      oneEighties: schema.matchPlayers.oneEighties,
      checkouts: schema.matchPlayers.checkouts,
    })
    .from(schema.matchPlayers)
    .innerJoin(schema.matches, eq(schema.matchPlayers.matchId, schema.matches.id))
    .where(
      and(eq(schema.matchPlayers.playerId, playerId), gte(schema.matches.finishedAt, since))
    )
    .orderBy(desc(schema.matches.finishedAt));
}

export async function persistFinishedMatch(match: StoredMatch): Promise<{
  ok: boolean;
  error?: string;
  updatedPlayerIds?: string[];
  /** True when skipped because the match had no registered (PIN) players */
  skippedGuestOnly?: boolean;
}> {
  const db = await getDb();
  if (!db) return { ok: false, error: "database_unavailable" };

  const existing = await db.query.matches.findFirst({
    where: eq(schema.matches.id, match.id),
  });
  if (existing) {
    // Match already stored — still attempt challenge credits (idempotent).
    // Uses full in-memory `match.state.turns`; summaryJson stays thin.
    try {
      await creditChallengesForMatch(match);
    } catch (err) {
      console.warn(
        "[no3-darts] challenge credit after existing match failed:",
        err instanceof Error ? err.message : err
      );
    }
    return { ok: true, updatedPlayerIds: [] };
  }

  // Authoritative: only ids that exist in `players` (PIN accounts) are persisted.
  // Guests may play, but never get match_players rows, aggregates, or leaderboard credit.
  const known = new Set<string>();
  for (const p of match.players) {
    if (p.isGuest === true) continue;
    const row = await db.query.players.findFirst({
      where: eq(schema.players.id, p.id),
      columns: { id: true },
    });
    if (row) known.add(row.id);
  }

  if (known.size === 0) {
    return { ok: true, updatedPlayerIds: [], skippedGuestOnly: true };
  }

  const registeredStats = match.summary.playerStats.filter((ps) => known.has(ps.playerId));
  const registeredPlayers = match.players.filter((p) => known.has(p.id));

  try {
    const updated = await db.transaction(async (tx) => {
      await tx.insert(schema.matches).values({
        id: match.id,
        finishedAt: new Date(match.finishedAt),
        mode: match.mode,
        modeLabel: match.modeLabel,
        winnerPlayerId: match.winnerId && known.has(match.winnerId) ? match.winnerId : null,
        // Keep display name even if a guest won — no player_id / stats credit for guests
        winnerName: match.winnerName,
        legs: match.summary.legs,
        sets: match.summary.sets,
        summaryJson: {
          playerStats: registeredStats,
          players: registeredPlayers,
        },
      });

      const updatedPlayerIds: string[] = [];

      for (const ps of registeredStats) {
        const st = match.state.playerStates.find((x) => x.playerId === ps.playerId);
        const finalScore =
          typeof ps.finalScore === "number" ? ps.finalScore : (st?.score ?? 0);
        await tx.insert(schema.matchPlayers).values({
          id: createId("mp"),
          matchId: match.id,
          playerId: ps.playerId,
          name: ps.name,
          isGuest: false,
          avg: ps.avg,
          oneEighties: ps.oneEighties,
          checkouts: ps.checkouts,
          highestCheckout: ps.highestCheckout,
          dartsThrown: st?.dartsThrown ?? 0,
          totalScore: st?.totalScore ?? 0,
          finalScore,
          legsWon: st?.legsWon ?? 0,
          checkoutAttempts: st?.checkoutAttempts ?? 0,
        });

        const player = await tx.query.players.findFirst({
          where: eq(schema.players.id, ps.playerId),
        });
        if (!player) continue;

        const won = match.winnerId === ps.playerId ? 1 : 0;
        await tx
          .update(schema.players)
          .set({
            matchesPlayed: player.matchesPlayed + 1,
            matchesWon: player.matchesWon + won,
            oneEighties: player.oneEighties + ps.oneEighties,
            checkoutsHit: player.checkoutsHit + ps.checkouts,
            highestCheckout: Math.max(player.highestCheckout, ps.highestCheckout),
            bestThreeDartAvg: Math.max(player.bestThreeDartAvg, ps.avg),
            dartsThrown: player.dartsThrown + (st?.dartsThrown ?? 0),
            totalScore: player.totalScore + (st?.totalScore ?? 0),
            legsWon: player.legsWon + (st?.legsWon ?? 0),
            checkoutAttempts: player.checkoutAttempts + (st?.checkoutAttempts ?? 0),
          })
          .where(eq(schema.players.id, ps.playerId));
        updatedPlayerIds.push(ps.playerId);
      }

      return updatedPlayerIds;
    });

    // After successful match insert: score timed challenges from final turns.
    try {
      await creditChallengesForMatch(match);
    } catch (err) {
      console.warn(
        "[no3-darts] challenge credit after persist failed:",
        err instanceof Error ? err.message : err
      );
    }

    return { ok: true, updatedPlayerIds: updated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    // Concurrent persist of the same match id
    if (msg.includes("duplicate") || msg.includes("unique")) {
      try {
        await creditChallengesForMatch(match);
      } catch {
        /* ignore */
      }
      return { ok: true, updatedPlayerIds: [] };
    }
    console.warn("[no3-darts] persistFinishedMatch failed:", msg || err);
    return { ok: false, error: "persist_failed" };
  }
}
