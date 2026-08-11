import { z } from "zod";
import type { GameModeId, ModeConfig } from "@/engine/types";
import type { LegModePolicy, TournamentFormat } from "./types";

export const GAME_MODE_IDS = [
  "x01",
  "cricket",
  "shanghai",
  "countup",
  "around_the_clock",
  "bermuda",
  "random_checkout",
  "killer",
  "baseball",
  "forty_one",
] as const satisfies readonly GameModeId[];

const modeIdSchema = z.enum(GAME_MODE_IDS);

/** Loose ModeConfig — engine validates on createGame. */
const modeConfigSchema: z.ZodType<ModeConfig> = z.object({
  mode: modeIdSchema,
  config: z.record(z.string(), z.unknown()),
}) as z.ZodType<ModeConfig>;

export const legModePolicySchema = z.enum(["fixed", "choose_each_leg", "preset_sequence"]);

export const tournamentFormatSchema = z
  .object({
    legsToWin: z.number().int().min(1).max(13).default(2),
    legModePolicy: legModePolicySchema.default("fixed"),
    allowedModes: z.array(modeIdSchema).min(1).default(["x01"]),
    fixedModeConfig: modeConfigSchema.nullable().optional(),
    presetSequence: z.array(modeConfigSchema).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.legModePolicy === "fixed") {
      if (!val.fixedModeConfig) {
        ctx.addIssue({
          code: "custom",
          message: "fixedModeConfig is required when legModePolicy is fixed",
          path: ["fixedModeConfig"],
        });
      } else if (!val.allowedModes.includes(val.fixedModeConfig.mode)) {
        ctx.addIssue({
          code: "custom",
          message: "fixedModeConfig.mode must be in allowedModes",
          path: ["fixedModeConfig"],
        });
      }
    }
    if (val.legModePolicy === "preset_sequence") {
      if (!val.presetSequence?.length) {
        ctx.addIssue({
          code: "custom",
          message: "presetSequence is required when legModePolicy is preset_sequence",
          path: ["presetSequence"],
        });
      } else {
        for (let i = 0; i < val.presetSequence.length; i++) {
          const m = val.presetSequence[i];
          if (!val.allowedModes.includes(m.mode)) {
            ctx.addIssue({
              code: "custom",
              message: `presetSequence[${i}].mode must be in allowedModes`,
              path: ["presetSequence", i],
            });
          }
        }
      }
    }
  });

export function parseTournamentFormat(input: unknown): TournamentFormat {
  return tournamentFormatSchema.parse(input);
}

export function parseLegModePolicy(input: unknown): LegModePolicy {
  return legModePolicySchema.parse(input);
}

/** Sensible bar defaults for a mode id (Killer needs numbers at start — use x01 fallback). */
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
      // Numbers assigned at lane start — empty map is a placeholder
      return { mode: "killer", config: { lives: 3, playerNumbers: {}, doublesOnly: true } };
    case "baseball":
      return { mode: "baseball", config: { innings: 9 } };
    case "forty_one":
      return { mode: "forty_one", config: {} };
  }
}

/**
 * Resolve ModeConfig for a 1-based leg number.
 * Returns null when choose_each_leg (caller must prompt).
 */
export function resolveModeForLeg(
  format: TournamentFormat,
  legNumber: number
): ModeConfig | null {
  if (format.legModePolicy === "fixed") {
    return format.fixedModeConfig ?? defaultModeConfig(format.allowedModes[0] ?? "x01");
  }
  if (format.legModePolicy === "preset_sequence") {
    const seq = format.presetSequence ?? [];
    const idx = Math.max(0, legNumber - 1);
    return seq[idx] ?? seq[seq.length - 1] ?? defaultModeConfig(format.allowedModes[0] ?? "x01");
  }
  // choose_each_leg
  return null;
}

export function bestOfLabel(legsToWin: number): string {
  return `Best of ${legsToWin * 2 - 1} (first to ${legsToWin})`;
}
