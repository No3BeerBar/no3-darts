import type { GameModeId, ModeConfig } from "./types";

/**
 * Sensible bar defaults for a mode id.
 * Killer still needs unique board numbers at lane start — empty map is a placeholder.
 */
export function defaultModeConfig(mode: GameModeId): ModeConfig {
  switch (mode) {
    case "x01":
      return { mode: "x01", config: { startScore: 501, doubleIn: false, doubleOut: true } };
    case "cricket":
      return { mode: "cricket", config: { variant: "standard" } };
    case "shanghai":
      return { mode: "shanghai", config: { maxRound: 20 } };
    case "countup":
      return { mode: "countup", config: { turns: 8 } };
    case "around_the_clock":
      return {
        mode: "around_the_clock",
        config: { direction: "up", requireDouble: false, includeBull: true },
      };
    case "bermuda":
      return { mode: "bermuda", config: {} };
    case "random_checkout":
      return { mode: "random_checkout", config: { minScore: 41, maxScore: 170, attempts: 10 } };
    case "killer":
      return { mode: "killer", config: { lives: 3, playerNumbers: {}, doublesOnly: true } };
    case "baseball":
      return { mode: "baseball", config: { innings: 9 } };
    case "forty_one":
      return { mode: "forty_one", config: {} };
  }
}

function isUsableConfigValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "number" && Number.isNaN(value)) return false;
  return true;
}

/**
 * Fill missing / null / NaN mode-config fields from {@link defaultModeConfig}.
 * Provided values win so tablet payloads stay unchanged.
 */
export function resolveModeConfig(
  modeConfig: { mode: GameModeId; config?: unknown }
): ModeConfig {
  const defaults = defaultModeConfig(modeConfig.mode);
  const incoming =
    modeConfig.config && typeof modeConfig.config === "object" && !Array.isArray(modeConfig.config)
      ? (modeConfig.config as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = {
    ...(defaults.config as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(incoming)) {
    if (isUsableConfigValue(value)) merged[key] = value;
  }
  return { mode: modeConfig.mode, config: merged } as ModeConfig;
}
