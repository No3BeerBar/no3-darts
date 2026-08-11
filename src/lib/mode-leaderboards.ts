/**
 * Mode → leaderboard metric mapping.
 * Every registered engine mode is leaderboard-eligible (at least wins).
 * Handlers opt into highScore / average / checkoutStats via `leaderboard` meta.
 */

import { listModes, getHandler, type GameModeId } from "@/engine";
import type { LeaderboardMetric } from "@/lib/leaderboard";

export type ModeLeaderboardSpec = {
  mode: GameModeId;
  label: string;
  /** Metrics ranked for this mode’s boards */
  metrics: LeaderboardMetric[];
};

/** Resolve metrics for one mode from its handler meta (wins always included). */
export function metricsForMode(mode: GameModeId): LeaderboardMetric[] {
  const meta = getHandler(mode).leaderboard ?? {};
  const metrics: LeaderboardMetric[] = ["wins"];
  if (meta.highScore) metrics.push("highScore");
  if (meta.average) metrics.push("avg");
  if (meta.checkoutStats) {
    metrics.push("oneEighties");
    metrics.push("highestCheckout");
  }
  return metrics;
}

/** Catalog of all registered modes with their board metrics (for API / TV). */
export function listModeLeaderboardSpecs(): ModeLeaderboardSpec[] {
  return listModes().map((m) => ({
    mode: m.id,
    label: m.name,
    metrics: metricsForMode(m.id),
  }));
}

/** Modes that should contribute to global 3-dart avg boards. */
export function averageModes(): GameModeId[] {
  return listModes()
    .map((m) => m.id)
    .filter((id) => getHandler(id).leaderboard?.average);
}

/** Modes that should contribute to 180 / checkout boards. */
export function checkoutModes(): GameModeId[] {
  return listModes()
    .map((m) => m.id)
    .filter((id) => getHandler(id).leaderboard?.checkoutStats);
}

/** Modes that track finishing score for high-score boards. */
export function highScoreModes(): GameModeId[] {
  return listModes()
    .map((m) => m.id)
    .filter((id) => getHandler(id).leaderboard?.highScore);
}

export function isKnownGameMode(raw: string): raw is GameModeId {
  return listModes().some((m) => m.id === raw);
}
