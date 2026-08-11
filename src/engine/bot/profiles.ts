/**
 * Bot difficulty profiles for bar play opponents.
 * Hardest seat is always named exactly "Luke Littler".
 */

import type { BotDifficulty } from "../types";

export type { BotDifficulty };

export interface BotProfile {
  id: BotDifficulty;
  /** Display name on the seat chip */
  displayName: string;
  /** Short badge label (e.g. EASY) */
  badge: string;
  /** Rough 3-dart average target when scoring (T20-ish aim) */
  scoringAvg: number;
  /**
   * Probability [0–1] the intended segment lands (triple/double/single aim).
   * Lower → more singles / neighbors / misses.
   */
  aimAccuracy: number;
  /** Probability of converting a finishable checkout attempt (double/bull). */
  checkoutSkill: number;
  /** Probability of hitting the intended cricket mark wedge. */
  cricketAccuracy: number;
  /** Bias toward T20 when scoring (Luke Littler elite). */
  trebleBias: number;
}

/** Ordered easiest → hardest. Luke Littler is always last. */
export const BOT_DIFFICULTY_ORDER: BotDifficulty[] = [
  "rookie",
  "pub",
  "league",
  "match",
  "pro",
  "luke_littler",
];

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  rookie: {
    id: "rookie",
    displayName: "Rookie",
    badge: "EASY",
    scoringAvg: 28,
    aimAccuracy: 0.22,
    checkoutSkill: 0.12,
    cricketAccuracy: 0.28,
    trebleBias: 0.15,
  },
  pub: {
    id: "pub",
    displayName: "Pub Regular",
    badge: "MEDIUM",
    scoringAvg: 45,
    aimAccuracy: 0.38,
    checkoutSkill: 0.28,
    cricketAccuracy: 0.42,
    trebleBias: 0.35,
  },
  league: {
    id: "league",
    displayName: "League Night",
    badge: "HARD",
    scoringAvg: 62,
    aimAccuracy: 0.52,
    checkoutSkill: 0.45,
    cricketAccuracy: 0.55,
    trebleBias: 0.55,
  },
  match: {
    id: "match",
    displayName: "Match Sharp",
    badge: "MATCH",
    scoringAvg: 78,
    aimAccuracy: 0.65,
    checkoutSkill: 0.6,
    cricketAccuracy: 0.68,
    trebleBias: 0.7,
  },
  pro: {
    id: "pro",
    displayName: "Pro",
    badge: "PRO",
    scoringAvg: 95,
    aimAccuracy: 0.78,
    checkoutSkill: 0.78,
    cricketAccuracy: 0.8,
    trebleBias: 0.85,
  },
  luke_littler: {
    id: "luke_littler",
    displayName: "Luke Littler",
    badge: "ELITE",
    scoringAvg: 110,
    aimAccuracy: 0.9,
    checkoutSkill: 0.92,
    cricketAccuracy: 0.9,
    trebleBias: 0.95,
  },
};

export function getBotProfile(difficulty: BotDifficulty): BotProfile {
  return BOT_PROFILES[difficulty];
}

/** Create a bot PlayerRef-shaped seat (caller adds to setup). */
export function createBotSeat(
  difficulty: BotDifficulty,
  idFactory: () => string
): {
  id: string;
  name: string;
  isGuest: true;
  isBot: true;
  botDifficulty: BotDifficulty;
} {
  const profile = getBotProfile(difficulty);
  return {
    id: idFactory(),
    name: profile.displayName,
    isGuest: true,
    isBot: true,
    botDifficulty: difficulty,
  };
}

export function isBotPlayer(p: {
  isBot?: boolean;
  botDifficulty?: BotDifficulty;
  isGuest?: boolean;
}): boolean {
  return p.isBot === true || p.botDifficulty != null;
}

export function resolveBotDifficulty(p: {
  botDifficulty?: BotDifficulty;
}): BotDifficulty {
  return p.botDifficulty ?? "pub";
}
