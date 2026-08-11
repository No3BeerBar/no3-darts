/**
 * Tournament v1 — single-elim, flexible leg/mode setup, 3 cooperating lanes.
 * Pure types (no DB / React).
 */

import type { GameModeId, ModeConfig } from "@/engine/types";

export const TOURNAMENT_LANES = ["Board 1", "Board 2", "Board 3"] as const;
export type TournamentLane = (typeof TOURNAMENT_LANES)[number];

export type TournamentStatus = "draft" | "active" | "completed";
export type TournamentMatchStatus = "pending" | "ready" | "in_progress" | "complete";

/** How each leg picks its game mode. */
export type LegModePolicy = "fixed" | "choose_each_leg" | "preset_sequence";

export interface TournamentFormat {
  /** First to N legs (best-of = 2N−1). */
  legsToWin: number;
  legModePolicy: LegModePolicy;
  /** Modes staff/players may pick when policy is choose_each_leg (or validation for fixed). */
  allowedModes: GameModeId[];
  /** Required when legModePolicy === "fixed". */
  fixedModeConfig?: ModeConfig | null;
  /** Required when legModePolicy === "preset_sequence" — index 0 = leg 1. */
  presetSequence?: ModeConfig[] | null;
}

export interface TournamentPlayer {
  id: string;
  tournamentId: string;
  displayName: string;
  isGuest: boolean;
  /** Link to registered PIN player when present — guests stay event-only. */
  registeredPlayerId: string | null;
  seed: number;
}

export interface TournamentMatch {
  id: string;
  tournamentId: string;
  /** 0 = first round … higher = closer to final */
  roundIndex: number;
  roundName: string;
  /** Slot within the round (0-based). */
  bracketSlot: number;
  playerAId: string | null;
  playerBId: string | null;
  status: TournamentMatchStatus;
  winnerId: string | null;
  lane: TournamentLane | null;
  liveGameId: string | null;
  nextMatchId: string | null;
  /** Which slot the winner fills in nextMatch. */
  nextMatchSlot: "A" | "B" | null;
  legsWonA: number;
  legsWonB: number;
}

export interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  createdAt: string; // ISO
  updatedAt: string;
  format: TournamentFormat;
  players: TournamentPlayer[];
  matches: TournamentMatch[];
}

export interface TournamentSummary {
  id: string;
  name: string;
  status: TournamentStatus;
  createdAt: string;
  playerCount: number;
  matchCount: number;
}

export interface LaneOverview {
  lane: TournamentLane;
  match: TournamentMatch | null;
  tournamentId: string | null;
  tournamentName: string | null;
  playerAName: string | null;
  playerBName: string | null;
}

/** Metadata attached to a live GameState for tournament legs. */
export interface TournamentGameMeta {
  tournamentId: string;
  matchId: string;
  legModePolicy: LegModePolicy;
  allowedModes: GameModeId[];
  fixedModeConfig?: ModeConfig | null;
  presetSequence?: ModeConfig[] | null;
  bracketPlayerAId: string;
  bracketPlayerBId: string;
}
