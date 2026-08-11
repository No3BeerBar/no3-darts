/**
 * Segment aim helpers — simulate plausible hits/misses around a target.
 */

import { BOARD_ORDER, createDart } from "../dart";
import type { DartThrow, SegmentKind } from "../types";
import type { BotProfile } from "./profiles";

export type Rng = () => number;

export function defaultRng(): number {
  return Math.random();
}

/** Adjacent board numbers (left/right neighbors). */
export function neighborsOf(n: number): [number, number] {
  const idx = BOARD_ORDER.indexOf(n as (typeof BOARD_ORDER)[number]);
  if (idx < 0) return [n, n];
  const left = BOARD_ORDER[(idx + BOARD_ORDER.length - 1) % BOARD_ORDER.length]!;
  const right = BOARD_ORDER[(idx + 1) % BOARD_ORDER.length]!;
  return [left, right];
}

export type AimTarget =
  | { kind: "triple" | "double" | "single"; number: number }
  | { kind: "bull" }
  | { kind: "outer_bull" }
  | { kind: "miss" };

function botDart(
  kind: SegmentKind,
  number: number,
  source: DartThrow["source"] = "bot"
): DartThrow {
  return createDart(kind, number, { source });
}

/**
 * Resolve an aimed segment into a plausible landing given bot skill.
 * Higher aimAccuracy → more intended hits; else singles / neighbors / miss.
 */
export function resolveAim(target: AimTarget, profile: BotProfile, rng: Rng = defaultRng): DartThrow {
  if (target.kind === "miss") return botDart("miss", 0);

  const roll = rng();

  if (target.kind === "bull") {
    if (roll < profile.aimAccuracy * 0.85) return botDart("bull", 50);
    if (roll < profile.aimAccuracy * 0.85 + 0.12) return botDart("outer_bull", 25);
    if (roll < 0.55) {
      const n = BOARD_ORDER[Math.floor(rng() * BOARD_ORDER.length)]!;
      return botDart("single", n);
    }
    return botDart("miss", 0);
  }

  if (target.kind === "outer_bull") {
    if (roll < profile.aimAccuracy) return botDart("outer_bull", 25);
    if (roll < profile.aimAccuracy + 0.08) return botDart("bull", 50);
    if (roll < 0.6) {
      const n = BOARD_ORDER[Math.floor(rng() * BOARD_ORDER.length)]!;
      return botDart("single", n);
    }
    return botDart("miss", 0);
  }

  const n = target.number;
  const [left, right] = neighborsOf(n);

  if (target.kind === "triple") {
    if (roll < profile.aimAccuracy * profile.trebleBias) return botDart("triple", n);
    if (roll < profile.aimAccuracy) return botDart("single", n);
    const missRoll = rng();
    if (missRoll < 0.45) return botDart("single", rng() < 0.5 ? left : right);
    if (missRoll < 0.7) return botDart("double", n);
    if (missRoll < 0.85) return botDart("single", n);
    return botDart("miss", 0);
  }

  if (target.kind === "double") {
    // Checkout doubles use checkoutSkill; scoring doubles use aimAccuracy.
    const hitP = profile.aimAccuracy;
    if (roll < hitP) return botDart("double", n);
    const missRoll = rng();
    if (missRoll < 0.4) return botDart("single", n);
    if (missRoll < 0.65) return botDart("single", rng() < 0.5 ? left : right);
    if (missRoll < 0.8) return botDart("triple", n);
    return botDart("miss", 0);
  }

  // single
  if (roll < Math.max(profile.aimAccuracy, 0.55)) return botDart("single", n);
  const missRoll = rng();
  if (missRoll < 0.5) return botDart("single", rng() < 0.5 ? left : right);
  if (missRoll < 0.7) return botDart("miss", 0);
  if (missRoll < 0.85) return botDart("double", n);
  return botDart("triple", n);
}

/** Checkout double / bull attempt — uses checkoutSkill. */
export function resolveCheckoutAim(
  target: AimTarget,
  profile: BotProfile,
  rng: Rng = defaultRng
): DartThrow {
  if (target.kind === "bull") {
    if (rng() < profile.checkoutSkill) return botDart("bull", 50);
    if (rng() < 0.35) return botDart("outer_bull", 25);
    if (rng() < 0.5) {
      const n = BOARD_ORDER[Math.floor(rng() * BOARD_ORDER.length)]!;
      return botDart("single", n);
    }
    return botDart("miss", 0);
  }
  if (target.kind === "double") {
    if (rng() < profile.checkoutSkill) return botDart("double", target.number);
    const [left, right] = neighborsOf(target.number);
    const missRoll = rng();
    if (missRoll < 0.45) return botDart("single", target.number);
    if (missRoll < 0.7) return botDart("single", rng() < 0.5 ? left : right);
    return botDart("miss", 0);
  }
  return resolveAim(target, profile, rng);
}
