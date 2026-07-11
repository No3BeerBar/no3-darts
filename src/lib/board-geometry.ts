/**
 * Shared dartboard geometry (viewBox units).
 * Layout leaves room for number ring so nothing is clipped.
 */

import { BOARD_ORDER } from "@/engine/dart";
import type { SegmentKind } from "@/engine";

/** Full SVG viewBox side length */
export const VB = 400;
/** Board center in viewBox */
export const CX = VB / 2;
export const CY = VB / 2;
/**
 * Radius of outer double wire.
 * Numbers sit outside this; keep margin so labels fit inside VB.
 * max extent ≈ CY + R * 1.14 ≈ 200 + 168 = 368 < 400 ✓
 */
export const BOARD_R = 148;

/** Normalized radii (fraction of BOARD_R) */
export const NR = {
  bull: 0.07,
  outerBull: 0.165,
  tripleInner: 0.56,
  tripleOuter: 0.62,
  doubleInner: 0.93,
  doubleOuter: 1.0,
  number: 1.12,
  miss: 1.08,
} as const;

export interface BoardHit {
  kind: SegmentKind;
  number: number;
  label: string;
  /** Exact position in SVG viewBox units */
  x: number;
  y: number;
  radiusNorm: number;
  angleDeg: number;
}

/** Screen pointer → SVG viewBox coords (handles CSS scaling) */
export function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

export function hitFromSvg(x: number, y: number): BoardHit {
  const dx = x - CX;
  const dy = y - CY;
  const dist = Math.hypot(dx, dy);
  const rNorm = dist / BOARD_R;

  // 0° = top (20), clockwise
  let angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  if (rNorm > NR.miss) {
    return {
      kind: "miss",
      number: 0,
      label: "MISS",
      x,
      y,
      radiusNorm: rNorm,
      angleDeg,
    };
  }
  if (rNorm <= NR.bull) {
    return {
      kind: "bull",
      number: 50,
      label: "BULL",
      x,
      y,
      radiusNorm: rNorm,
      angleDeg,
    };
  }
  if (rNorm <= NR.outerBull) {
    return {
      kind: "outer_bull",
      number: 25,
      label: "25",
      x,
      y,
      radiusNorm: rNorm,
      angleDeg,
    };
  }

  const idx = Math.floor((angleDeg + 9) / 18) % 20;
  const number = BOARD_ORDER[idx];

  let kind: SegmentKind;
  if (rNorm >= NR.tripleInner && rNorm <= NR.tripleOuter) kind = "triple";
  else if (rNorm >= NR.doubleInner && rNorm <= NR.doubleOuter) kind = "double";
  else kind = "single";

  const label =
    kind === "single" ? `S${number}` : kind === "double" ? `D${number}` : `T${number}`;

  return { kind, number, label, x, y, radiusNorm: rNorm, angleDeg };
}

export function hitFromClient(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): BoardHit | null {
  const p = clientToSvg(svg, clientX, clientY);
  if (!p) return null;
  return hitFromSvg(p.x, p.y);
}

/** Wedge path for segment index i (0 = 20 at top) */
export function wedgePath(i: number, rInner: number, rOuter: number): string {
  const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180;
  const a1 = (((i + 1) * 18 - 9 - 90) * Math.PI) / 180;
  const ro = BOARD_R * rOuter;
  const ri = BOARD_R * rInner;
  const x0 = CX + ro * Math.cos(a0);
  const y0 = CY + ro * Math.sin(a0);
  const x1 = CX + ro * Math.cos(a1);
  const y1 = CY + ro * Math.sin(a1);
  const x2 = CX + ri * Math.cos(a1);
  const y2 = CY + ri * Math.sin(a1);
  const x3 = CX + ri * Math.cos(a0);
  const y3 = CY + ri * Math.sin(a0);
  return `M ${x0} ${y0} A ${ro} ${ro} 0 0 1 ${x1} ${y1} L ${x2} ${y2} A ${ri} ${ri} 0 0 0 ${x3} ${y3} Z`;
}

export function segmentCenter(i: number, rNorm: number): { x: number; y: number } {
  const a = ((i * 18 - 90) * Math.PI) / 180;
  return {
    x: CX + BOARD_R * rNorm * Math.cos(a),
    y: CY + BOARD_R * rNorm * Math.sin(a),
  };
}
