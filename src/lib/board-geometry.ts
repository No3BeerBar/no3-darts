/**
 * Shared dartboard geometry (viewBox units).
 * Layout leaves room for number ring so nothing is clipped.
 *
 * Angle convention: 0° = top (center of 20), increasing clockwise.
 * Standard BOARD_ORDER: 20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5.
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
  /** Outside the double wire — miss (not a ghost single) */
  miss: 1.0,
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

/** Normalize degrees to [0, 360). */
export function normalizeAngleDeg(angleDeg: number): number {
  const a = angleDeg % 360;
  return a < 0 ? a + 360 : a;
}

/**
 * Segment index 0–19 for a board angle (0° = top / 20, clockwise).
 * Wedge centers at i*18°; boundaries at i*18 ± 9.
 */
export function segmentIndexForAngle(angleDeg: number): number {
  const a = normalizeAngleDeg(angleDeg);
  return Math.floor((a + 9) / 18) % 20;
}

/** Board number (1–20) at a polar angle. */
export function boardNumberAtAngle(angleDeg: number): number {
  return BOARD_ORDER[segmentIndexForAngle(angleDeg)]!;
}

/** SVG viewBox point for polar board coords (0° = top, clockwise). */
export function svgPointForPolar(
  angleDeg: number,
  radiusNorm: number,
): { x: number; y: number } {
  const a = (normalizeAngleDeg(angleDeg) * Math.PI) / 180;
  return {
    x: CX + BOARD_R * radiusNorm * Math.sin(a),
    y: CY - BOARD_R * radiusNorm * Math.cos(a),
  };
}

/**
 * Screen pointer → SVG viewBox coords.
 *
 * Uses getBoundingClientRect + viewBox (xMidYMid meet) instead of getScreenCTM.
 * CSS filters on the SVG (e.g. drop-shadow) break CTM on WebKit/iPad and shift
 * polar hits by neighboring wedges — production smoke saw T20 → T5 / S19.
 */
export function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const vb = svg.viewBox?.baseVal;
  const vbX = vb && Number.isFinite(vb.x) ? vb.x : 0;
  const vbY = vb && Number.isFinite(vb.y) ? vb.y : 0;
  const vbW = vb && vb.width > 0 ? vb.width : VB;
  const vbH = vb && vb.height > 0 ? vb.height : VB;

  // Default preserveAspectRatio: xMidYMid meet
  const scale = Math.min(rect.width / vbW, rect.height / vbH);
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const contentW = vbW * scale;
  const contentH = vbH * scale;
  const ox = rect.left + (rect.width - contentW) / 2;
  const oy = rect.top + (rect.height - contentH) / 2;

  return {
    x: vbX + (clientX - ox) / scale,
    y: vbY + (clientY - oy) / scale,
  };
}

export function hitFromSvg(x: number, y: number): BoardHit {
  const dx = x - CX;
  const dy = y - CY;
  const dist = Math.hypot(dx, dy);
  const rNorm = dist / BOARD_R;

  // 0° = top (20), clockwise — matches wedgePath / labels / dartPin
  const angleDeg = normalizeAngleDeg((Math.atan2(dx, -dy) * 180) / Math.PI);

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

  const number = boardNumberAtAngle(angleDeg);

  let kind: SegmentKind;
  if (rNorm >= NR.tripleInner && rNorm <= NR.tripleOuter) kind = "triple";
  else if (rNorm >= NR.doubleInner && rNorm <= NR.doubleOuter) kind = "double";
  else kind = "single";

  const label =
    kind === "single"
      ? `S${number}`
      : kind === "double"
        ? `D${number}`
        : `T${number}`;

  return { kind, number, label, x, y, radiusNorm: rNorm, angleDeg };
}

export function hitFromClient(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): BoardHit | null {
  const p = clientToSvg(svg, clientX, clientY);
  if (!p) return null;
  return hitFromSvg(p.x, p.y);
}

/** Wedge path for segment index i (0 = 20 at top, clockwise). */
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

export function segmentCenter(
  i: number,
  rNorm: number,
): { x: number; y: number } {
  const a = ((i * 18 - 90) * Math.PI) / 180;
  return {
    x: CX + BOARD_R * rNorm * Math.cos(a),
    y: CY + BOARD_R * rNorm * Math.sin(a),
  };
}
