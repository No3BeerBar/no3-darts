/**
 * Single-elimination bracket generation + winner advancement.
 * Pure functions — unit-tested, no I/O.
 */

import { createId } from "@/engine";
import type { TournamentMatch, TournamentMatchStatus, TournamentPlayer } from "./types";

export function nextPowerOfTwo(n: number): number {
  if (n < 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function roundNameForSize(bracketSize: number, roundIndex: number): string {
  const sizeAtRound = bracketSize / 2 ** roundIndex;
  if (sizeAtRound <= 2) return "Final";
  if (sizeAtRound <= 4) return "Semifinals";
  if (sizeAtRound <= 8) return "Quarterfinals";
  return `Round of ${sizeAtRound}`;
}

export interface GenerateBracketInput {
  tournamentId: string;
  /** Ordered by seed (lower seed = stronger / earlier placement). */
  players: TournamentPlayer[];
  /** Inject for tests; defaults to createId("tmatch"). */
  idFactory?: () => string;
}

export interface GenerateBracketResult {
  matches: TournamentMatch[];
  bracketSize: number;
  byeCount: number;
}

/**
 * Build a full single-elim bracket. Pads to power-of-2 with byes.
 * First-round byes auto-complete and feed the winner into the next round.
 */
export function generateSingleElimBracket(input: GenerateBracketInput): GenerateBracketResult {
  const { tournamentId, players } = input;
  const mkId = input.idFactory ?? (() => createId("tmatch"));

  if (players.length < 2) {
    throw new Error("Need at least 2 players to start a tournament");
  }

  const bracketSize = nextPowerOfTwo(players.length);
  const byeCount = bracketSize - players.length;
  const roundCount = Math.log2(bracketSize);

  // Create matches round by round (round 0 = first round)
  const byRound: TournamentMatch[][] = [];
  for (let r = 0; r < roundCount; r++) {
    const matchCount = bracketSize / 2 ** (r + 1);
    const round: TournamentMatch[] = [];
    for (let s = 0; s < matchCount; s++) {
      round.push({
        id: mkId(),
        tournamentId,
        roundIndex: r,
        roundName: roundNameForSize(bracketSize, r),
        bracketSlot: s,
        playerAId: null,
        playerBId: null,
        status: "pending",
        winnerId: null,
        lane: null,
        liveGameId: null,
        nextMatchId: null,
        nextMatchSlot: null,
        legsWonA: 0,
        legsWonB: 0,
      });
    }
    byRound.push(round);
  }

  // Wire next-match pointers
  for (let r = 0; r < roundCount - 1; r++) {
    for (let s = 0; s < byRound[r].length; s++) {
      const next = byRound[r + 1][Math.floor(s / 2)];
      byRound[r][s].nextMatchId = next.id;
      byRound[r][s].nextMatchSlot = s % 2 === 0 ? "A" : "B";
    }
  }

  // Fill first round: top seeds get byes (player A only), then pair the rest.
  // Example 6→8: bye, bye, play, play.
  const first = byRound[0];
  let pi = 0;
  for (let s = 0; s < first.length; s++) {
    if (s < byeCount) {
      first[s].playerAId = players[pi++]?.id ?? null;
      first[s].playerBId = null;
    } else {
      first[s].playerAId = players[pi++]?.id ?? null;
      first[s].playerBId = players[pi++]?.id ?? null;
    }
  }

  // Auto-advance byes in first round (and cascade if needed)
  const all = byRound.flat();
  const byId = new Map(all.map((m) => [m.id, m]));

  for (const m of first) {
    applyByeIfNeeded(m, byId);
  }

  // Mark remaining matches with both players as ready
  for (const m of all) {
    if (m.status === "pending" && m.playerAId && m.playerBId) {
      m.status = "ready";
    }
  }

  return { matches: all, bracketSize, byeCount };
}

function applyByeIfNeeded(
  match: TournamentMatch,
  byId: Map<string, TournamentMatch>
): void {
  const hasA = Boolean(match.playerAId);
  const hasB = Boolean(match.playerBId);
  if (hasA && hasB) return;
  if (!hasA && !hasB) return; // empty — wait for feeders
  if (match.status === "complete") return;

  const winnerId = match.playerAId ?? match.playerBId;
  if (!winnerId) return;

  match.winnerId = winnerId;
  match.status = "complete";
  advanceWinnerInMap(match, byId);
}

/**
 * Advance the winner of a completed match into the next bracket slot.
 * Mutates the matches map / objects. Returns the next match if any.
 */
export function advanceWinner(matches: TournamentMatch[], completedMatchId: string): {
  matches: TournamentMatch[];
  nextMatch: TournamentMatch | null;
  tournamentComplete: boolean;
} {
  const byId = new Map(matches.map((m) => [m.id, { ...m }]));
  const completed = byId.get(completedMatchId);
  if (!completed) throw new Error("Match not found");
  if (completed.status !== "complete" || !completed.winnerId) {
    throw new Error("Match must be complete with a winner before advancing");
  }

  const next = advanceWinnerInMap(completed, byId);
  const list = Array.from(byId.values()).sort(
    (a, b) => a.roundIndex - b.roundIndex || a.bracketSlot - b.bracketSlot
  );

  const finals = list.filter((m) => !m.nextMatchId);
  const tournamentComplete = finals.every((m) => m.status === "complete");

  return { matches: list, nextMatch: next, tournamentComplete };
}

function advanceWinnerInMap(
  completed: TournamentMatch,
  byId: Map<string, TournamentMatch>
): TournamentMatch | null {
  if (!completed.nextMatchId || !completed.winnerId || !completed.nextMatchSlot) {
    return null;
  }
  const next = byId.get(completed.nextMatchId);
  if (!next) return null;

  if (completed.nextMatchSlot === "A") {
    next.playerAId = completed.winnerId;
  } else {
    next.playerBId = completed.winnerId;
  }

  // If both players now set → ready; if only one and other feeder done with bye-style → check
  if (next.playerAId && next.playerBId && next.status === "pending") {
    next.status = "ready";
  }

  // If the other feeder is already complete with a bye leaving only one player, stay pending until both
  // (standard: both slots filled from previous round winners)

  byId.set(next.id, next);
  return next;
}

/**
 * Assert a physical lane is free. There is one Board 1/2/3 in the bar, so callers
 * must pass every non-completed match that currently holds this lane — including
 * other tournaments. `exceptMatchId` allows re-assign / move of the same match.
 */
export function assertLaneUnique(
  matches: TournamentMatch[],
  lane: string,
  exceptMatchId?: string
): void {
  const taken = matches.find(
    (m) => m.id !== exceptMatchId && m.lane === lane && m.status !== "complete"
  );
  if (taken) {
    throw new Error(`${lane} is already assigned to another active match`);
  }
}

export function canAssignLane(status: TournamentMatchStatus): boolean {
  return status === "ready" || status === "pending" || status === "in_progress";
}
