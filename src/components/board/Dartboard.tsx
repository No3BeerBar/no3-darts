"use client";

/**
 * Modern No.3-themed interactive dartboard.
 * Laser marks sit at exact pointer positions; all darts in the visit stay marked.
 */

import { useCallback, useRef, useState } from "react";
import { BOARD_ORDER, type DartThrow, type SegmentKind } from "@/engine";
import {
  BOARD_R,
  CX,
  CY,
  NR,
  VB,
  hitFromClient,
  type BoardHit,
  wedgePath,
} from "@/lib/board-geometry";
import { cn } from "@/lib/utils";

export interface DartboardProps {
  /** @deprecated use `marks` — kept for single-dart call sites */
  highlight?: DartThrow | null;
  /** All darts to show as laser marks (e.g. current visit) */
  marks?: DartThrow[];
  size?: number;
  className?: string;
  interactive?: boolean;
  onScore?: (kind: SegmentKind, number: number, meta?: { angle: number; radius: number }) => void;
  showLiveLabel?: boolean;
}

export function Dartboard({
  highlight,
  marks,
  size = 360,
  className,
  interactive = false,
  onScore,
  showLiveLabel = true,
}: DartboardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<BoardHit | null>(null);
  /** Live drag pin only (cleared after score so marks prop owns pins) */
  const [livePin, setLivePin] = useState<{ x: number; y: number } | null>(null);

  const allMarks: DartThrow[] = marks ?? (highlight ? [highlight] : []);

  const sample = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    return hitFromClient(svg, clientX, clientY);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragging.current = true;
    const h = sample(e.clientX, e.clientY);
    setHover(h);
    if (h) setLivePin({ x: h.x, y: h.y });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive || !dragging.current) return;
    e.preventDefault();
    const h = sample(e.clientX, e.clientY);
    setHover(h);
    if (h) setLivePin({ x: h.x, y: h.y });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!interactive || !dragging.current) return;
    e.preventDefault();
    dragging.current = false;
    const h = sample(e.clientX, e.clientY);
    setHover(null);
    setLivePin(null);
    if (h) {
      onScore?.(h.kind, h.number, { angle: h.angleDeg, radius: h.radiusNorm });
    }
  };

  const onPointerCancel = () => {
    dragging.current = false;
    setHover(null);
    setLivePin(null);
  };

  const isLit = (kind: string, num: number) => {
    if (hover) {
      if (kind === "bull") return hover.kind === "bull";
      if (kind === "outer_bull") return hover.kind === "outer_bull";
      return hover.kind === kind && hover.number === num;
    }
    return allMarks.some((d) => {
      if (kind === "bull") return d.kind === "bull";
      if (kind === "outer_bull") return d.kind === "outer_bull";
      return d.kind === kind && d.number === num;
    });
  };

  const pins = allMarks
    .map((d, i) => ({ pos: dartPin(d), index: i, dart: d }))
    .filter((p): p is { pos: { x: number; y: number }; index: number; dart: DartThrow } => p.pos != null);

  return (
    <div className={cn("relative flex flex-col items-center", className)}>
      {showLiveLabel && interactive && (
        <div
          className={cn(
            "mb-2 min-h-10 rounded-lg px-4 py-1.5 font-logo text-2xl tabular-nums transition",
            hover
              ? "bg-[rgb(225_6_0/0.18)] text-[var(--brand-red-bright)]"
              : "text-zinc-600"
          )}
        >
          {hover?.label ?? "—"}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB} ${VB}`}
        width={size}
        height={size}
        className={cn(
          "max-w-full select-none drop-shadow-[0_8px_32px_rgba(0,0,0,0.55)]",
          interactive && "touch-none cursor-crosshair"
        )}
        style={interactive ? { touchAction: "none" } : undefined}
        role={interactive ? "application" : "img"}
        aria-label="Dartboard"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <defs>
          <radialGradient id="boardFace" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#2a2a2e" />
            <stop offset="100%" stopColor="#0c0c0e" />
          </radialGradient>
          <radialGradient id="laserCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="40%" stopColor="#ff6b6b" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#e10600" stopOpacity="0" />
          </radialGradient>
          <filter id="laserGlow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={CX} cy={CY} r={BOARD_R * NR.number + 10} fill="#0a0a0a" />
        <circle
          cx={CX}
          cy={CY}
          r={BOARD_R * NR.number + 6}
          fill="none"
          stroke="rgb(225 6 0 / 0.35)"
          strokeWidth={2}
        />
        <circle cx={CX} cy={CY} r={BOARD_R * 1.02} fill="url(#boardFace)" />

        {BOARD_ORDER.map((num, i) => {
          const dark = i % 2 === 0;
          const singleA = dark ? "#1c1c20" : "#e6e2d8";
          const singleB = dark ? "#141416" : "#d4d0c6";
          const multiA = dark ? "#c41e1e" : "#1a8f45";
          const multiB = dark ? "#8f1212" : "#0f6b32";
          const lit = "#f5c518";

          return (
            <g key={num}>
              <path
                d={wedgePath(i, NR.doubleInner, NR.doubleOuter)}
                fill={isLit("double", num) ? lit : multiA}
                stroke="#050505"
                strokeWidth={0.6}
              />
              <path
                d={wedgePath(i, NR.tripleOuter, NR.doubleInner)}
                fill={isLit("single", num) ? lit : singleA}
                stroke="#050505"
                strokeWidth={0.4}
              />
              <path
                d={wedgePath(i, NR.tripleInner, NR.tripleOuter)}
                fill={isLit("triple", num) ? lit : multiB}
                stroke="#050505"
                strokeWidth={0.6}
              />
              <path
                d={wedgePath(i, NR.outerBull, NR.tripleInner)}
                fill={isLit("single", num) ? lit : singleB}
                stroke="#050505"
                strokeWidth={0.4}
              />
              <text
                x={CX + BOARD_R * NR.number * Math.cos(((i * 18 - 90) * Math.PI) / 180)}
                y={CY + BOARD_R * NR.number * Math.sin(((i * 18 - 90) * Math.PI) / 180)}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#c4c4c8"
                fontFamily="Oswald, system-ui, sans-serif"
                fontWeight={600}
                fontSize={15}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {num}
              </text>
            </g>
          );
        })}

        <circle
          cx={CX}
          cy={CY}
          r={BOARD_R * NR.outerBull}
          fill={isLit("outer_bull", 25) ? "#f5c518" : "#1a8f45"}
          stroke="#050505"
          strokeWidth={0.8}
        />
        <circle
          cx={CX}
          cy={CY}
          r={BOARD_R * NR.bull}
          fill={isLit("bull", 50) ? "#f5c518" : "#c41e1e"}
          stroke="#050505"
          strokeWidth={0.8}
        />

        {[NR.doubleOuter, NR.doubleInner, NR.tripleOuter, NR.tripleInner, NR.outerBull, NR.bull].map(
          (nr) => (
            <circle
              key={nr}
              cx={CX}
              cy={CY}
              r={BOARD_R * nr}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={0.5}
              style={{ pointerEvents: "none" }}
            />
          )
        )}

        {/* All darts this visit */}
        {pins.map(({ pos, index }) => (
          <LaserMark
            key={`mark-${index}`}
            x={pos.x}
            y={pos.y}
            label={String(index + 1)}
            active={index === pins.length - 1 && !livePin}
          />
        ))}

        {/* Live drag preview */}
        {livePin && <LaserMark x={livePin.x} y={livePin.y} active preview />}
      </svg>
    </div>
  );
}

/** Slightly larger laser pointer — still tight and precise */
function LaserMark({
  x,
  y,
  label,
  active = false,
  preview = false,
}: {
  x: number;
  y: number;
  label?: string;
  active?: boolean;
  preview?: boolean;
}) {
  const tick = 6.5;
  const gap = 2.2;
  const bloom = preview ? 8 : active ? 7.5 : 6.5;
  const core = preview ? 2.4 : active ? 2.2 : 1.9;
  const opacity = preview ? 1 : active ? 1 : 0.88;

  return (
    <g style={{ pointerEvents: "none" }} filter="url(#laserGlow)" opacity={opacity}>
      <circle cx={x} cy={y} r={bloom} fill="url(#laserCore)" opacity={0.5} />
      <line
        x1={x - tick}
        y1={y}
        x2={x - gap}
        y2={y}
        stroke="#fff"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <line
        x1={x + gap}
        y1={y}
        x2={x + tick}
        y2={y}
        stroke="#fff"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <line
        x1={x}
        y1={y - tick}
        x2={x}
        y2={y - gap}
        stroke="#fff"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <line
        x1={x}
        y1={y + gap}
        x2={x}
        y2={y + tick}
        stroke="#fff"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <circle cx={x} cy={y} r={core} fill="#fff" />
      <circle cx={x} cy={y} r={core * 0.45} fill="#e10600" />
      {label && (
        <text
          x={x + 7}
          y={y - 6}
          fill="#fff"
          fontSize={9}
          fontFamily="Oswald, system-ui, sans-serif"
          fontWeight={600}
          style={{ userSelect: "none" }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function dartPin(d: DartThrow): { x: number; y: number } | null {
  if (typeof d.angle === "number" && typeof d.radius === "number") {
    const a = (d.angle * Math.PI) / 180;
    const rn = Math.min(d.radius, 1.05);
    return {
      x: CX + BOARD_R * rn * Math.sin(a),
      y: CY - BOARD_R * rn * Math.cos(a),
    };
  }
  if (d.kind === "bull" || d.kind === "outer_bull") {
    // slight offset so stacked bulls aren't fully hidden
    return { x: CX, y: CY };
  }
  if (d.kind === "miss") return null;
  const idx = BOARD_ORDER.indexOf(d.number as (typeof BOARD_ORDER)[number]);
  if (idx < 0) return null;
  const rNorm =
    d.kind === "triple" ? 0.59 : d.kind === "double" ? 0.965 : 0.75;
  const a = ((idx * 18 - 90) * Math.PI) / 180;
  return {
    x: CX + BOARD_R * rNorm * Math.cos(a),
    y: CY + BOARD_R * rNorm * Math.sin(a),
  };
}
