"use client";

import { useState } from "react";
import type { SegmentKind } from "@/engine";
import { segmentLabel } from "@/engine";
import { DragCorrectBoard } from "./DragCorrectBoard";
import { cn } from "@/lib/utils";

interface CorrectDartModalProps {
  slotIndex: number;
  currentLabel?: string;
  onPick: (kind: SegmentKind, number: number) => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * iPad-first correction: drag on the board (primary) or tap the key grid.
 */
export function CorrectDartModal({
  slotIndex,
  currentLabel,
  onPick,
  onClear,
  onClose,
}: CorrectDartModalProps) {
  const [tab, setTab] = useState<"drag" | "keys">("drag");
  const nums = Array.from({ length: 20 }, (_, i) => i + 1);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 p-2 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Correct dart"
      onClick={onClose}
    >
      <div
        className="flex max-h-[96dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[rgb(225_6_0/0.35)] bg-[#121212] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
          <div>
            <div className="font-display text-[10px] tracking-widest text-zinc-500">
              Dart {slotIndex + 1}
              {currentLabel ? ` · was ${currentLabel}` : ""}
            </div>
            <div className="font-display text-lg text-white">Fix score</div>
          </div>
          <button type="button" className="btn-ghost min-h-11 px-4" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex shrink-0 gap-1 p-2">
          <button
            type="button"
            className={cn(
              "min-h-11 flex-1 rounded-lg font-display text-sm tracking-wider",
              tab === "drag" ? "bg-[var(--brand-red)] text-white" : "bg-zinc-800 text-zinc-400"
            )}
            onClick={() => setTab("drag")}
          >
            Drag board
          </button>
          <button
            type="button"
            className={cn(
              "min-h-11 flex-1 rounded-lg font-display text-sm tracking-wider",
              tab === "keys" ? "bg-[var(--brand-red)] text-white" : "bg-zinc-800 text-zinc-400"
            )}
            onClick={() => setTab("keys")}
          >
            Keys
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {tab === "drag" ? (
            <DragCorrectBoard
              size={Math.min(360, typeof window !== "undefined" ? window.innerWidth - 40 : 320)}
              onConfirm={(kind, number) => onPick(kind, number)}
            />
          ) : (
            <div className="space-y-2 pt-1">
              <Row label="S" accent="zinc" nums={nums} onPick={(n) => onPick("single", n)} />
              <Row label="D" accent="red" nums={nums} onPick={(n) => onPick("double", n)} />
              <Row label="T" accent="green" nums={nums} onPick={(n) => onPick("triple", n)} />
              <div className="grid grid-cols-3 gap-2 pt-1">
                <KeyBtn className="bg-emerald-900" onClick={() => onPick("outer_bull", 25)}>
                  25
                </KeyBtn>
                <KeyBtn className="bg-[var(--brand-red)]" onClick={() => onPick("bull", 50)}>
                  BULL
                </KeyBtn>
                <KeyBtn className="bg-zinc-700" onClick={() => onPick("miss", 0)}>
                  MISS
                </KeyBtn>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-800 p-3">
          <button
            type="button"
            className="btn-ghost min-h-12 w-full border-[rgb(225_6_0/0.4)] text-[var(--brand-red-bright)]"
            onClick={onClear}
          >
            Clear this dart
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  nums,
  onPick,
  accent,
}: {
  label: string;
  nums: number[];
  onPick: (n: number) => void;
  accent: "zinc" | "red" | "green";
}) {
  const cls =
    accent === "red"
      ? "border-[rgb(225_6_0/0.35)] bg-[rgb(225_6_0/0.12)] text-red-100"
      : accent === "green"
        ? "border-emerald-900/50 bg-emerald-950/50 text-emerald-100"
        : "border-zinc-700 bg-zinc-800 text-zinc-100";

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 shrink-0 text-center font-display text-xs text-zinc-500">{label}</span>
      <div className="grid flex-1 grid-cols-10 gap-1">
        {nums.map((n) => (
          <button
            key={`${label}${n}`}
            type="button"
            title={segmentLabel(
              label === "S" ? "single" : label === "D" ? "double" : "triple",
              n
            )}
            onClick={() => onPick(n)}
            className={cn(
              "min-h-11 rounded-md border text-sm font-bold active:scale-95",
              cls
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function KeyBtn({
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
        "min-h-14 rounded-xl font-display text-base text-white active:scale-95",
        className
      )}
    >
      {children}
    </button>
  );
}
