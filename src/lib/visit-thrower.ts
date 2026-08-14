/**
 * Who threw a completed visit — always a player/seat name for recent-visit UI.
 */

import { getTeamForPlayer, type GameState, type Turn } from "@/engine";

/** Player (or seat) name for a finalized visit. Never empty. */
export function visitThrowerName(state: GameState, turn: Turn): string {
  const player = state.players.find((p) => p.id === turn.playerId);
  const name = player?.name?.trim();
  if (name) return name;
  const idx = state.players.findIndex((p) => p.id === turn.playerId);
  return idx >= 0 ? `Seat ${idx + 1}` : "Seat";
}

/** Doubles: "Alice · Team A". Singles: just the thrower. */
export function visitThrowerLabel(state: GameState, turn: Turn): string {
  const thrower = visitThrowerName(state, turn);
  const team = getTeamForPlayer(state, turn.playerId);
  if (team && team.playerIds.length > 1) {
    return `${thrower} · ${team.name}`;
  }
  return thrower;
}
