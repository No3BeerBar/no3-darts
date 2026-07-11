"use client";

import type { SegmentKind } from "@/engine";
import { cn } from "@/lib/utils";

interface DartQuickKeysProps {
  onDart: (kind: SegmentKind, number: number) => void;
  className?: string;
}

const NUMS = Array.from({ length: 20 }, (_, i) => i + 1);

export function DartQuickKeys({ onDart, className }: DartQuickKeysProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Row label="S" nums={NUMS} kind="single" onDart={onDart} accent="zinc" />
      <Row label="D" nums={NUMS} kind="double" onDart={onDart} accent="red" />
      <Row label="T" nums={NUMS} kind="triple" onDart={onDart} accent="green" />
      <div className="flex gap-2">
        <Key className="flex-1 bg-emerald-800 hover:bg-emerald-700" onClick={() => onDart("outer_bull", 25)}>
          25
        </Key>
        <Key className="flex-1 bg-red-800 hover:bg-red-700" onClick={() => onDart("bull", 50)}>
          BULL
        </Key>
        <Key className="flex-1 bg-zinc-700 hover:bg-zinc-600" onClick={() => onDart("miss", 0)}>
          MISS
        </Key>
      </div>
    </div>
  );
}

function Row({
  label,
  nums,
  kind,
  onDart,
  accent,
}: {
  label: string;
  nums: number[];
  kind: SegmentKind;
  onDart: (kind: SegmentKind, number: number) => void;
  accent: "zinc" | "red" | "green";
}) {
  const accentCls =
    accent === "red"
      ? "border-red-900/50 bg-red-950/40 hover:bg-red-900/50 text-red-100"
      : accent === "green"
        ? "border-emerald-900/50 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-100"
        : "border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-100";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="w-6 shrink-0 text-center text-xs font-bold text-zinc-500">{label}</span>
        <div className="grid grid-cols-10 gap-1 flex-1">
          {nums.map((n) => (
            <button
              key={`${kind}-${n}`}
              type="button"
              onClick={() => onDart(kind, n)}
              className={cn(
                "h-9 rounded-md border text-sm font-semibold transition active:scale-95",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]",
                accentCls
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Key({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-12 rounded-xl text-base font-bold text-white transition active:scale-95",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]",
        className
      )}
    >
      {children}
    </button>
  );
}
