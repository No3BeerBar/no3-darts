/**
 * Dart segment helpers – scoring values, labels, polar geometry hints.
 */

import type { DartThrow, SegmentKind } from "./types";

let _seq = 0;
export function createId(prefix = "d"): string {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`;
}

/** Compute point value for a segment */
export function segmentValue(kind: SegmentKind, number: number): number {
  switch (kind) {
    case "miss":
      return 0;
    case "outer_bull":
      return 25;
    case "bull":
      return 50;
    case "single":
      return number;
    case "double":
      return number * 2;
    case "triple":
      return number * 3;
    default:
      return 0;
  }
}

/** Short label for UI / callouts */
export function segmentLabel(kind: SegmentKind, number: number): string {
  switch (kind) {
    case "miss":
      return "MISS";
    case "outer_bull":
      return "25";
    case "bull":
      return "BULL";
    case "single":
      return `S${number}`;
    case "double":
      return `D${number}`;
    case "triple":
      return `T${number}`;
    default:
      return "?";
  }
}

export function createDart(
  kind: SegmentKind,
  number: number,
  opts?: Partial<Pick<DartThrow, "angle" | "radius" | "source" | "id" | "timestamp">>
): DartThrow {
  const value = segmentValue(kind, number);
  return {
    id: opts?.id ?? createId("dart"),
    kind,
    number: kind === "outer_bull" ? 25 : kind === "bull" ? 50 : kind === "miss" ? 0 : number,
    value,
    timestamp: opts?.timestamp ?? Date.now(),
    angle: opts?.angle,
    radius: opts?.radius,
    source: opts?.source ?? "manual",
  };
}

/** Parse labels like "T20", "D16", "S5", "25", "BULL", "DBULL", "0", "MISS" */
export function parseDartLabel(raw: string): DartThrow | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  if (s === "MISS" || s === "0" || s === "M") return createDart("miss", 0);
  if (s === "BULL" || s === "DBULL" || s === "50" || s === "DB") return createDart("bull", 50);
  if (s === "25" || s === "OBULL" || s === "SBULL" || s === "SB") return createDart("outer_bull", 25);

  const m = s.match(/^([SDT])(\d{1,2})$/);
  if (m) {
    const kind = m[1] === "S" ? "single" : m[1] === "D" ? "double" : "triple";
    const n = parseInt(m[2], 10);
    if (n < 1 || n > 20) return null;
    if (kind === "triple" && (n < 1 || n > 20)) return null;
    return createDart(kind as SegmentKind, n);
  }

  // Bare number 1–20 = single
  if (/^\d{1,3}$/.test(s)) {
    const n = parseInt(s, 10);
    if (n === 25) return createDart("outer_bull", 25);
    if (n === 50) return createDart("bull", 50);
    if (n >= 1 && n <= 20) return createDart("single", n);
    // Multi-dart total entry is handled elsewhere
    return null;
  }

  return null;
}

/** Is this dart a double (including bull)? */
export function isDouble(dart: DartThrow): boolean {
  return dart.kind === "double" || dart.kind === "bull";
}

/** Cricket-relevant segment number (15–20 or 25 for bull) */
export function cricketNumber(dart: DartThrow): number | null {
  if (dart.kind === "bull" || dart.kind === "outer_bull") return 25;
  if (dart.kind === "miss") return null;
  if (dart.number >= 15 && dart.number <= 20) return dart.number;
  return null;
}

/** Marks awarded in cricket (single=1, double=2, triple=3, outer bull=1, bull=2) */
export function cricketMarks(dart: DartThrow): number {
  if (dart.kind === "outer_bull") return 1;
  if (dart.kind === "bull") return 2;
  if (dart.kind === "single") return 1;
  if (dart.kind === "double") return 2;
  if (dart.kind === "triple") return 3;
  return 0;
}

/** Board order clockwise from top (20) – standard dartboard */
export const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;

export function boardAngleForNumber(n: number): number {
  const idx = BOARD_ORDER.indexOf(n as (typeof BOARD_ORDER)[number]);
  if (idx < 0) return 0;
  // Each segment is 18°; 20 is at top (-90° in canvas coords often)
  return idx * 18;
}
