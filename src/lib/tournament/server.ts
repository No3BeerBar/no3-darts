/**
 * Tournament persistence + orchestration (Postgres via Drizzle).
 * Returns null / throws typed errors when DB is down — callers degrade.
 */

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { createId } from "@/engine";
import { advanceWinner, assertLaneUnique, generateSingleElimBracket } from "./bracket";
import { defaultModeConfig, parseTournamentFormat } from "./modes";
import type {
  LaneOverview,
  Tournament,
  TournamentFormat,
  TournamentLane,
  TournamentMatch,
  TournamentMatchStatus,
  TournamentPlayer,
  TournamentStatus,
  TournamentSummary,
} from "./types";
import { TOURNAMENT_LANES } from "./types";

const { tournaments, tournamentPlayers, tournamentMatches } = schema;

export class TournamentError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "TournamentError";
  }
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function mapPlayer(row: typeof tournamentPlayers.$inferSelect): TournamentPlayer {
  return {
    id: row.id,
    tournamentId: row.tournamentId,
    displayName: row.displayName,
    isGuest: row.isGuest,
    registeredPlayerId: row.registeredPlayerId,
    seed: row.seed,
  };
}

function mapMatch(row: typeof tournamentMatches.$inferSelect): TournamentMatch {
  return {
    id: row.id,
    tournamentId: row.tournamentId,
    roundIndex: row.roundIndex,
    roundName: row.roundName,
    bracketSlot: row.bracketSlot,
    playerAId: row.playerAId,
    playerBId: row.playerBId,
    status: row.status as TournamentMatchStatus,
    winnerId: row.winnerId,
    lane: (row.lane as TournamentLane | null) ?? null,
    liveGameId: row.liveGameId,
    nextMatchId: row.nextMatchId,
    nextMatchSlot: (row.nextMatchSlot as "A" | "B" | null) ?? null,
    legsWonA: row.legsWonA,
    legsWonB: row.legsWonB,
  };
}

function mapTournament(
  row: typeof tournaments.$inferSelect,
  players: TournamentPlayer[],
  matches: TournamentMatch[]
): Tournament {
  return {
    id: row.id,
    name: row.name,
    status: row.status as TournamentStatus,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    format: parseTournamentFormat(row.formatJson),
    players,
    matches,
  };
}

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TournamentError(
      isDatabaseConfigured()
        ? "Postgres unreachable — tournaments need DATABASE_URL"
        : "DATABASE_URL not configured — tournaments unavailable",
      503
    );
  }
  return db;
}

export async function listTournaments(): Promise<TournamentSummary[] | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(tournaments)
    .orderBy(desc(tournaments.createdAt))
    .limit(50);

  const out: TournamentSummary[] = [];
  for (const row of rows) {
    const [pc] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tournamentPlayers)
      .where(eq(tournamentPlayers.tournamentId, row.id));
    const [mc] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tournamentMatches)
      .where(eq(tournamentMatches.tournamentId, row.id));
    out.push({
      id: row.id,
      name: row.name,
      status: row.status as TournamentStatus,
      createdAt: toIso(row.createdAt),
      playerCount: pc?.n ?? 0,
      matchCount: mc?.n ?? 0,
    });
  }
  return out;
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1);
  if (!row) return null;

  const players = (
    await db
      .select()
      .from(tournamentPlayers)
      .where(eq(tournamentPlayers.tournamentId, id))
      .orderBy(asc(tournamentPlayers.seed))
  ).map(mapPlayer);

  const matches = (
    await db
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.tournamentId, id))
      .orderBy(asc(tournamentMatches.roundIndex), asc(tournamentMatches.bracketSlot))
  ).map(mapMatch);

  return mapTournament(row, players, matches);
}

export interface CreateTournamentInput {
  name: string;
  format?: Partial<TournamentFormat>;
  players?: Array<{
    displayName: string;
    isGuest?: boolean;
    registeredPlayerId?: string | null;
  }>;
}

export async function createTournament(input: CreateTournamentInput): Promise<Tournament> {
  const db = await requireDb();
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new TournamentError("Tournament name must be 2–80 characters");
  }

  const format = parseTournamentFormat({
    legsToWin: input.format?.legsToWin ?? 2,
    legModePolicy: input.format?.legModePolicy ?? "fixed",
    allowedModes: input.format?.allowedModes ?? ["x01"],
    fixedModeConfig:
      input.format?.fixedModeConfig ??
      (input.format?.legModePolicy === "choose_each_leg" ||
      input.format?.legModePolicy === "preset_sequence"
        ? null
        : defaultModeConfig("x01")),
    presetSequence: input.format?.presetSequence ?? null,
  });

  const id = createId("tourn");
  const now = new Date();

  await db.insert(tournaments).values({
    id,
    name,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    formatJson: format,
  });

  const playerInputs = input.players ?? [];
  for (let i = 0; i < playerInputs.length; i++) {
    const p = playerInputs[i];
    const displayName = p.displayName.trim();
    if (!displayName) continue;
    await db.insert(tournamentPlayers).values({
      id: createId("tplayer"),
      tournamentId: id,
      displayName,
      isGuest: p.isGuest ?? !p.registeredPlayerId,
      registeredPlayerId: p.registeredPlayerId ?? null,
      seed: i + 1,
    });
  }

  const t = await getTournament(id);
  if (!t) throw new TournamentError("Failed to load created tournament", 500);
  return t;
}

export interface UpdateTournamentInput {
  name?: string;
  format?: Partial<TournamentFormat>;
  /** Replace full roster when provided (draft only). */
  players?: Array<{
    displayName: string;
    isGuest?: boolean;
    registeredPlayerId?: string | null;
  }>;
}

export async function updateTournament(
  id: string,
  input: UpdateTournamentInput
): Promise<Tournament> {
  const db = await requireDb();
  const existing = await getTournament(id);
  if (!existing) throw new TournamentError("Tournament not found", 404);
  if (existing.status !== "draft") {
    throw new TournamentError("Only draft tournaments can be edited");
  }

  const format = input.format
    ? parseTournamentFormat({ ...existing.format, ...input.format })
    : existing.format;

  const name = input.name?.trim() ?? existing.name;
  if (name.length < 2 || name.length > 80) {
    throw new TournamentError("Tournament name must be 2–80 characters");
  }

  await db
    .update(tournaments)
    .set({ name, formatJson: format, updatedAt: new Date() })
    .where(eq(tournaments.id, id));

  if (input.players) {
    await db.delete(tournamentPlayers).where(eq(tournamentPlayers.tournamentId, id));
    for (let i = 0; i < input.players.length; i++) {
      const p = input.players[i];
      const displayName = p.displayName.trim();
      if (!displayName) continue;
      await db.insert(tournamentPlayers).values({
        id: createId("tplayer"),
        tournamentId: id,
        displayName,
        isGuest: p.isGuest ?? !p.registeredPlayerId,
        registeredPlayerId: p.registeredPlayerId ?? null,
        seed: i + 1,
      });
    }
  }

  const t = await getTournament(id);
  if (!t) throw new TournamentError("Tournament not found", 404);
  return t;
}

export async function startTournament(id: string): Promise<Tournament> {
  const db = await requireDb();
  const existing = await getTournament(id);
  if (!existing) throw new TournamentError("Tournament not found", 404);
  if (existing.status !== "draft") {
    throw new TournamentError("Tournament already started");
  }
  if (existing.players.length < 2) {
    throw new TournamentError("Add at least 2 players before starting");
  }

  // Validate format once more
  parseTournamentFormat(existing.format);

  const { matches } = generateSingleElimBracket({
    tournamentId: id,
    players: existing.players,
  });

  await db.delete(tournamentMatches).where(eq(tournamentMatches.tournamentId, id));

  for (const m of matches) {
    await db.insert(tournamentMatches).values({
      id: m.id,
      tournamentId: m.tournamentId,
      roundIndex: m.roundIndex,
      roundName: m.roundName,
      bracketSlot: m.bracketSlot,
      playerAId: m.playerAId,
      playerBId: m.playerBId,
      status: m.status,
      winnerId: m.winnerId,
      lane: m.lane,
      liveGameId: m.liveGameId,
      nextMatchId: m.nextMatchId,
      nextMatchSlot: m.nextMatchSlot,
      legsWonA: m.legsWonA,
      legsWonB: m.legsWonB,
    });
  }

  await db
    .update(tournaments)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(tournaments.id, id));

  const t = await getTournament(id);
  if (!t) throw new TournamentError("Tournament not found", 404);
  return t;
}

function normalizeLane(lane: string): TournamentLane {
  const trimmed = lane.trim();
  const found = TOURNAMENT_LANES.find((l) => l.toLowerCase() === trimmed.toLowerCase());
  if (!found) {
    throw new TournamentError(`Lane must be one of: ${TOURNAMENT_LANES.join(", ")}`);
  }
  return found;
}

export async function assignMatchLane(
  tournamentId: string,
  matchId: string,
  lane: string | null
): Promise<TournamentMatch> {
  const db = await requireDb();
  const t = await getTournament(tournamentId);
  if (!t) throw new TournamentError("Tournament not found", 404);
  if (t.status !== "active") throw new TournamentError("Tournament is not active");

  const match = t.matches.find((m) => m.id === matchId);
  if (!match) throw new TournamentError("Match not found", 404);
  if (match.status === "complete") {
    throw new TournamentError("Cannot assign a completed match");
  }
  if (!match.playerAId || !match.playerBId) {
    throw new TournamentError("Match is not ready (waiting for players)");
  }

  if (lane === null || lane === "" || lane === "free") {
    await db
      .update(tournamentMatches)
      .set({ lane: null })
      .where(eq(tournamentMatches.id, matchId));
    const updated = (await getTournament(tournamentId))?.matches.find((m) => m.id === matchId);
    if (!updated) throw new TournamentError("Match not found", 404);
    return updated;
  }

  const laneId = normalizeLane(lane);
  assertLaneUnique(t.matches, laneId, matchId);

  await db
    .update(tournamentMatches)
    .set({
      lane: laneId,
      status: match.status === "pending" ? "ready" : match.status,
    })
    .where(eq(tournamentMatches.id, matchId));

  await db
    .update(tournaments)
    .set({ updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  const updated = (await getTournament(tournamentId))?.matches.find((m) => m.id === matchId);
  if (!updated) throw new TournamentError("Match not found", 404);
  return updated;
}

export async function linkLiveGame(
  tournamentId: string,
  matchId: string,
  liveGameId: string
): Promise<TournamentMatch> {
  const db = await requireDb();
  const t = await getTournament(tournamentId);
  if (!t) throw new TournamentError("Tournament not found", 404);
  const match = t.matches.find((m) => m.id === matchId);
  if (!match) throw new TournamentError("Match not found", 404);
  if (match.status === "complete") throw new TournamentError("Match already complete");

  await db
    .update(tournamentMatches)
    .set({ liveGameId, status: "in_progress" })
    .where(eq(tournamentMatches.id, matchId));

  const updated = (await getTournament(tournamentId))?.matches.find((m) => m.id === matchId);
  if (!updated) throw new TournamentError("Match not found", 404);
  return updated;
}

export interface CompleteMatchInput {
  winnerId: string;
  liveGameId?: string | null;
  legsWonA?: number;
  legsWonB?: number;
}

export async function completeTournamentMatch(
  tournamentId: string,
  matchId: string,
  input: CompleteMatchInput
): Promise<Tournament> {
  const db = await requireDb();
  const t = await getTournament(tournamentId);
  if (!t) throw new TournamentError("Tournament not found", 404);
  if (t.status !== "active") throw new TournamentError("Tournament is not active");

  const match = t.matches.find((m) => m.id === matchId);
  if (!match) throw new TournamentError("Match not found", 404);
  if (match.status === "complete") throw new TournamentError("Match already complete");

  if (input.winnerId !== match.playerAId && input.winnerId !== match.playerBId) {
    throw new TournamentError("Winner must be one of the match players");
  }

  const completed: TournamentMatch = {
    ...match,
    status: "complete",
    winnerId: input.winnerId,
    liveGameId: input.liveGameId ?? match.liveGameId,
    legsWonA: input.legsWonA ?? match.legsWonA,
    legsWonB: input.legsWonB ?? match.legsWonB,
    lane: null, // free the lane
  };

  const working = t.matches.map((m) => (m.id === matchId ? completed : { ...m }));
  const { matches: advanced, tournamentComplete } = advanceWinner(working, matchId);

  for (const m of advanced) {
    await db
      .update(tournamentMatches)
      .set({
        playerAId: m.playerAId,
        playerBId: m.playerBId,
        status: m.status,
        winnerId: m.winnerId,
        lane: m.id === matchId ? null : m.lane,
        liveGameId: m.id === matchId ? (input.liveGameId ?? m.liveGameId) : m.liveGameId,
        legsWonA: m.legsWonA,
        legsWonB: m.legsWonB,
        nextMatchId: m.nextMatchId,
        nextMatchSlot: m.nextMatchSlot,
      })
      .where(eq(tournamentMatches.id, m.id));
  }

  await db
    .update(tournaments)
    .set({
      status: tournamentComplete ? "completed" : "active",
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));

  const result = await getTournament(tournamentId);
  if (!result) throw new TournamentError("Tournament not found", 404);
  return result;
}

export async function getLaneOverview(): Promise<LaneOverview[] | null> {
  const db = await getDb();
  if (!db) return null;

  const active = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.status, "active"));

  if (!active.length) {
    return TOURNAMENT_LANES.map((lane) => ({
      lane,
      match: null,
      tournamentId: null,
      tournamentName: null,
      playerAName: null,
      playerBName: null,
    }));
  }

  const activeIds = active.map((t) => t.id);
  const nameById = new Map(active.map((t) => [t.id, t.name]));

  const assigned = await db
    .select()
    .from(tournamentMatches)
    .where(
      and(
        inArray(tournamentMatches.tournamentId, activeIds),
        or(
          eq(tournamentMatches.status, "ready"),
          eq(tournamentMatches.status, "in_progress")
        )
      )
    );

  const withLane = assigned.filter((m) => Boolean(m.lane));

  const playerRows = await db
    .select()
    .from(tournamentPlayers)
    .where(inArray(tournamentPlayers.tournamentId, activeIds));
  const playerName = new Map(playerRows.map((p) => [p.id, p.displayName]));

  return TOURNAMENT_LANES.map((lane) => {
    const row = withLane.find((m) => m.lane === lane);
    if (!row) {
      return {
        lane,
        match: null,
        tournamentId: null,
        tournamentName: null,
        playerAName: null,
        playerBName: null,
      };
    }
    return {
      lane,
      match: mapMatch(row),
      tournamentId: row.tournamentId,
      tournamentName: nameById.get(row.tournamentId) ?? null,
      playerAName: row.playerAId ? playerName.get(row.playerAId) ?? null : null,
      playerBName: row.playerBId ? playerName.get(row.playerBId) ?? null : null,
    };
  });
}

export async function getLaneAssignedMatch(room: string): Promise<{
  tournament: Tournament;
  match: TournamentMatch;
  playerA: TournamentPlayer | null;
  playerB: TournamentPlayer | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  let lane: TournamentLane;
  try {
    lane = normalizeLane(room);
  } catch {
    return null;
  }

  const overview = await getLaneOverview();
  if (!overview) return null;
  const slot = overview.find((o) => o.lane === lane);
  if (!slot?.match || !slot.tournamentId) return null;

  const t = await getTournament(slot.tournamentId);
  if (!t) return null;
  const match = t.matches.find((m) => m.id === slot.match!.id);
  if (!match) return null;

  return {
    tournament: t,
    match,
    playerA: t.players.find((p) => p.id === match.playerAId) ?? null,
    playerB: t.players.find((p) => p.id === match.playerBId) ?? null,
  };
}
