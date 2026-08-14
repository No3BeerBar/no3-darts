/**
 * Target vs last-hit paint on the dartboard.
 *
 * Objective (41 / any-double / baseball / killer) stays gold for the whole
 * visit. A dart that lands elsewhere must not steal that gold — it gets a
 * brief red flash, then only the laser mark remains.
 */

import type { DartThrow, SegmentKind } from "@/engine";

/** Last-hit segment flash, then fade. Target gold never uses this timer. */
export const HIT_FLASH_MS = 1100;

export const TARGET_GOLD = "#f5c518";
export const HIT_FLASH_FILL = "#e10600";
export const HIT_ON_TARGET_FLASH = "rgba(255,255,255,0.42)";

export type BoardFocusSpec = {
  focusNumber?: number | null;
  focusNumbers?: number[] | null;
  focusKind?: "wedge" | "double";
  focusRing?: "double" | "triple" | null;
  focusBull?: boolean;
};

export type SegmentPaintRole = "target" | "hit" | "hitOnTarget" | "base";

export function dartMatchesSegment(
  dart: Pick<DartThrow, "kind" | "number"> | null | undefined,
  kind: string,
  num: number
): boolean {
  if (!dart) return false;
  if (kind === "bull") return dart.kind === "bull";
  if (kind === "outer_bull") return dart.kind === "outer_bull";
  if (dart.kind === "miss") return false;
  return dart.kind === kind && dart.number === num;
}

export function lastVisitDart(
  marks: DartThrow[] | null | undefined
): DartThrow | null {
  if (!marks?.length) return null;
  return marks[marks.length - 1] ?? null;
}

export function lastDartKey(dart: DartThrow | null | undefined): string {
  if (!dart) return "";
  return `${dart.id}:${dart.timestamp}:${dart.kind}:${dart.number}`;
}

/** True when this ring is part of the current objective (aim). */
export function isObjectiveSegment(
  kind: SegmentKind | "single" | "double" | "triple" | "outer_bull" | "bull",
  num: number,
  focus: BoardFocusSpec
): boolean {
  if (kind === "miss") return false;
  if (kind === "bull" || kind === "outer_bull") {
    return Boolean(focus.focusBull);
  }
  const primary =
    typeof focus.focusNumber === "number" &&
    focus.focusNumber >= 1 &&
    focus.focusNumber <= 20 &&
    focus.focusNumber === num;
  const secondary =
    Array.isArray(focus.focusNumbers) &&
    focus.focusNumbers.includes(num) &&
    num >= 1 &&
    num <= 20;
  if (primary || secondary) {
    if (focus.focusKind === "double") return kind === "double";
    return true;
  }
  if (kind === "double" && focus.focusRing === "double") return true;
  if (kind === "triple" && focus.focusRing === "triple") return true;
  return false;
}

/**
 * Target always wins the persistent paint. Hit flash is a second treatment
 * and never replaces the objective after it fades.
 */
export function segmentPaintRole(opts: {
  isObjective: boolean;
  isLastHit: boolean;
  hitFlashActive: boolean;
}): SegmentPaintRole {
  if (opts.isObjective && opts.isLastHit && opts.hitFlashActive) {
    return "hitOnTarget";
  }
  if (opts.isObjective) return "target";
  if (opts.isLastHit && opts.hitFlashActive) return "hit";
  return "base";
}
