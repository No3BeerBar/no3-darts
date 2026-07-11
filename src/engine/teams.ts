/**
 * Team / doubles support.
 *
 * - Up to 2 players per team (singles or doubles)
 * - Shared score / marks / open status per team
 * - Individual stats (avg, 180s, darts) stay per thrower
 * - Throw order: A1, B1, A2, B2… (partners alternate with opponents)
 */

import { createId } from "./dart";
import type { GameModeId, GameState, PlayerGameState, PlayerRef, TeamRef } from "./types";

/** Modes that support team play (shared score). */
export const TEAM_MODES: GameModeId[] = [
  "x01",
  "cricket",
  "shanghai",
  "countup",
  "around_the_clock",
  "bermuda",
];

export function modeSupportsTeams(mode: GameModeId): boolean {
  return TEAM_MODES.includes(mode);
}

/** One player per team (FFA / singles). */
export function soloTeamsFromPlayers(players: PlayerRef[]): TeamRef[] {
  return players.map((p, i) => ({
    id: createId("team"),
    name: p.name,
    playerIds: [p.id],
    order: i,
  }));
}

/**
 * Build teams from an explicit draft (2+ teams, 1–2 players each).
 * Throw order will be: T1-p1, T2-p1, … Tn-p1, T1-p2, T2-p2, …
 */
export function buildTeamsFromDraft(
  draft: Array<{ name: string; players: PlayerRef[] }>
): { teams: TeamRef[]; players: PlayerRef[] } {
  if (draft.length < 2) {
    throw new Error("Need at least 2 teams");
  }
  const teams: TeamRef[] = [];
  const players: PlayerRef[] = [];
  const seen = new Set<string>();

  draft.forEach((d, order) => {
    if (d.players.length < 1 || d.players.length > 2) {
      throw new Error(`Team "${d.name || order + 1}" needs 1 or 2 players`);
    }
    for (const p of d.players) {
      if (seen.has(p.id)) throw new Error(`${p.name} is on more than one team`);
      seen.add(p.id);
      players.push(p);
    }
    const defaultName =
      d.players.length === 2
        ? `${d.players[0].name} / ${d.players[1].name}`
        : d.players[0].name;
    teams.push({
      id: createId("team"),
      name: d.name.trim() || defaultName,
      playerIds: d.players.map((p) => p.id),
      order,
    });
  });

  return { teams, players };
}

/** @deprecated use buildTeamsFromDraft — kept for callers that still pass 4 flat players */
export function doublesTeamsFromPlayers(
  players: PlayerRef[],
  names?: [string, string]
): TeamRef[] {
  if (players.length !== 4) {
    throw new Error("Legacy doubles helper needs exactly 4 players");
  }
  return buildTeamsFromDraft([
    { name: names?.[0] ?? "", players: [players[0], players[1]] },
    { name: names?.[1] ?? "", players: [players[2], players[3]] },
  ]).teams;
}

/**
 * Throw order indices into `players[]`.
 * For doubles 2v2: A1, B1, A2, B2.
 * For singles: sequential team order.
 */
export function buildThrowOrder(players: PlayerRef[], teams: TeamRef[]): number[] {
  const sorted = [...teams].sort((a, b) => a.order - b.order);
  const maxSize = Math.max(...sorted.map((t) => t.playerIds.length), 1);
  const order: number[] = [];

  for (let slot = 0; slot < maxSize; slot++) {
    for (const team of sorted) {
      const pid = team.playerIds[slot];
      if (!pid) continue;
      const idx = players.findIndex((p) => p.id === pid);
      if (idx >= 0) order.push(idx);
    }
  }

  if (order.length === 0) {
    return players.map((_, i) => i);
  }
  return order;
}

export function ensureTeams(state: GameState): TeamRef[] {
  if (state.teams?.length) return state.teams;
  return soloTeamsFromPlayers(state.players);
}

export function getTeamForPlayer(state: GameState, playerId: string): TeamRef | undefined {
  return ensureTeams(state).find((t) => t.playerIds.includes(playerId));
}

export function getTeamById(state: GameState, teamId: string): TeamRef | undefined {
  return ensureTeams(state).find((t) => t.id === teamId);
}

export function isTeamGame(state: GameState): boolean {
  const teams = ensureTeams(state);
  return teams.some((t) => t.playerIds.length > 1);
}

export function teamDisplayName(state: GameState, teamOrPlayerId: string): string {
  const team = getTeamById(state, teamOrPlayerId);
  if (team) return team.name;
  const asTeam = getTeamForPlayer(state, teamOrPlayerId);
  if (asTeam && asTeam.playerIds.length > 1) return asTeam.name;
  return state.players.find((p) => p.id === teamOrPlayerId)?.name ?? "—";
}

/** Shared gameplay fields that stay in sync across partners. */
const SHARED_KEYS: (keyof PlayerGameState)[] = [
  "score",
  "legsWon",
  "setsWon",
  "marks",
  "nextTarget",
  "hasOpened",
];

/**
 * After a teammate scores / opens / marks, mirror shared state to partners.
 * Individual stats (dartsThrown, totalScore, 180s, …) stay on the thrower.
 */
export function syncTeamSharedState(state: GameState, sourcePlayerId: string): void {
  const team = getTeamForPlayer(state, sourcePlayerId);
  if (!team || team.playerIds.length < 2) return;

  const src = state.playerStates.find((p) => p.playerId === sourcePlayerId);
  if (!src) return;

  for (const pid of team.playerIds) {
    if (pid === sourcePlayerId) continue;
    const dest = state.playerStates.find((p) => p.playerId === pid);
    if (!dest) continue;
    for (const key of SHARED_KEYS) {
      const val = src[key];
      if (val !== undefined) {
        // deep clone marks
        if (key === "marks" && val && typeof val === "object") {
          dest.marks = { ...(val as Record<number, number>) };
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (dest as any)[key] = val;
        }
      }
    }
  }
}

/** Advance to next thrower in throw order. Returns true if wrapped to start of order (new round). */
export function advanceThrower(state: GameState): boolean {
  const order =
    state.throwOrder?.length > 0
      ? state.throwOrder
      : state.players.map((_, i) => i);
  const pos = order.indexOf(state.currentPlayerIndex);
  const from = pos >= 0 ? pos : 0;
  const nextPos = (from + 1) % order.length;
  state.currentPlayerIndex = order[nextPos] ?? 0;
  return nextPos === 0;
}

export function setThrowerByPlayerId(state: GameState, playerId: string): void {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx >= 0) state.currentPlayerIndex = idx;
}

/** Next player after leg win: first thrower of the losing team, or next in order. */
export function nextLegStartingIndex(state: GameState, legWinnerPlayerId: string | null): number {
  const order =
    state.throwOrder?.length > 0
      ? state.throwOrder
      : state.players.map((_, i) => i);
  if (!legWinnerPlayerId) return order[0] ?? 0;

  const winTeam = getTeamForPlayer(state, legWinnerPlayerId);
  // Start with first player of a non-winning team in throw order
  for (const idx of order) {
    const pid = state.players[idx]?.id;
    if (!pid) continue;
    const t = getTeamForPlayer(state, pid);
    if (winTeam && t && t.id === winTeam.id) continue;
    return idx;
  }
  // fallback: next after winner in order
  const wIdx = state.players.findIndex((p) => p.id === legWinnerPlayerId);
  const pos = order.indexOf(wIdx);
  return order[(pos + 1) % order.length] ?? 0;
}

/** Team score for display (any member). */
export function getTeamScore(state: GameState, teamId: string): number {
  const team = getTeamById(state, teamId);
  if (!team) return 0;
  const ps = state.playerStates.find((p) => p.playerId === team.playerIds[0]);
  return ps?.score ?? 0;
}

/** Unique team rows for scoreboards (one entry per team). */
export function teamScoreRows(state: GameState): Array<{
  team: TeamRef;
  score: number;
  legsWon: number;
  setsWon: number;
  active: boolean;
  throwerId: string | null;
  playerNames: string[];
  marks?: Record<number, number>;
}> {
  const teams = ensureTeams(state);
  const currentId = state.players[state.currentPlayerIndex]?.id;
  return teams.map((team) => {
    const lead = state.playerStates.find((p) => p.playerId === team.playerIds[0])!;
    const throwerId =
      team.playerIds.find((id) => id === currentId) ?? null;
    return {
      team,
      score: lead?.score ?? 0,
      legsWon: lead?.legsWon ?? 0,
      setsWon: lead?.setsWon ?? 0,
      active: Boolean(throwerId) && state.status === "playing",
      throwerId,
      playerNames: team.playerIds.map(
        (id) => state.players.find((p) => p.id === id)?.name ?? "?"
      ),
      marks: lead?.marks,
    };
  });
}
