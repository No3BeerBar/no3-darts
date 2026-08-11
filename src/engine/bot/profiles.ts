/**
 * Bot difficulty profiles for bar play opponents.
 * Hardest seat is always named exactly "Luke Littler".
 *
 * Calibration (Aug 2026 — see docs/PLAY.md):
 * Luke Littler targets real-world recent form ~100–103 3-dart average and
 * ~43–46% checkout. Aim/treble knobs are tuned so simulated T20-lane scoring
 * visits land near scoringAvg; checkoutSkill is the finish conversion rate
 * (elite, not perfect — not 90%).
 */

import type { BotDifficulty } from "../types";

export type { BotDifficulty };

export interface BotProfile {
  id: BotDifficulty;
  /** Display name on the seat chip */
  displayName: string;
  /** Short badge label (e.g. EASY) */
  badge: string;
  /**
   * Rough 3-dart average target when scoring (T20-ish aim).
   * Luke ≈ 101 (12-mo ~101.1 / L200 ~103 band).
   */
  scoringAvg: number;
  /**
   * Probability [0–1] the intended segment lands (triple/double/single aim).
   * Lower → more singles / neighbors / misses.
   * Paired with trebleBias so simulated scoring ≈ scoringAvg.
   */
  aimAccuracy: number;
  /**
   * Probability of converting a finishable checkout attempt (double/bull).
   * Luke ≈ 0.45 (real checkout % ~43–46%), not near-perfect.
   */
  checkoutSkill: number;
  /** Probability of hitting the intended cricket mark wedge. */
  cricketAccuracy: number;
  /** Bias toward T20 when scoring (“Nuke” style for Luke). */
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
    scoringAvg: 40,
    aimAccuracy: 0.18,
    checkoutSkill: 0.12,
    cricketAccuracy: 0.28,
    trebleBias: 0.15,
  },
  pub: {
    id: "pub",
    displayName: "Pub Regular",
    badge: "MEDIUM",
    scoringAvg: 52,
    aimAccuracy: 0.28,
    checkoutSkill: 0.22,
    cricketAccuracy: 0.4,
    trebleBias: 0.35,
  },
  league: {
    id: "league",
    displayName: "League Night",
    badge: "HARD",
    scoringAvg: 65,
    aimAccuracy: 0.36,
    checkoutSkill: 0.3,
    cricketAccuracy: 0.52,
    trebleBias: 0.55,
  },
  match: {
    id: "match",
    displayName: "Match Sharp",
    badge: "MATCH",
    scoringAvg: 80,
    aimAccuracy: 0.43,
    checkoutSkill: 0.36,
    cricketAccuracy: 0.65,
    trebleBias: 0.7,
  },
  pro: {
    id: "pro",
    displayName: "Pro",
    badge: "PRO",
    scoringAvg: 92,
    aimAccuracy: 0.47,
    checkoutSkill: 0.4,
    cricketAccuracy: 0.75,
    trebleBias: 0.82,
  },
  luke_littler: {
    id: "luke_littler",
    displayName: "Luke Littler",
    badge: "ELITE",
    // Real-world band ~100–103; checkout ~43–46%; heavy T20 (“Nuke”).
    scoringAvg: 101,
    aimAccuracy: 0.5,
    checkoutSkill: 0.45,
    cricketAccuracy: 0.85,
    trebleBias: 0.92,
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
