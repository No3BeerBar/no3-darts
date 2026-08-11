"use client";

import { segmentLabel, type DartThrow } from "@/engine";
import { cn } from "@/lib/utils";

export function TurnDarts({
  darts,
  className,
  interactive = false,
  onSlotClick,
  compact = false,
  /** Override per-dart points (e.g. Baseball: wrong number = 0) */
  pointsForDart,
  showDartPoints = false,
  /** When true, Σ is not a valid visit total (e.g. exact-41 with a miss). */
  totalVoided = false,
}: {
  darts: DartThrow[];
  className?: string;
  interactive?: boolean;
  onSlotClick?: (index: number) => void;
  compact?: boolean;
  pointsForDart?: (dart: DartThrow) => number;
  showDartPoints?: boolean;
  totalVoided?: boolean;
}) {
  const slots = [0, 1, 2];
  const dartPts = (d: DartThrow) => (pointsForDart ? pointsForDart(d) : d.value);
  const total = darts.reduce((a, d) => a + dartPts(d), 0);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {slots.map((i) => {
        const d = darts[i];
        const clickable = interactive && (Boolean(d) || i === darts.length);
        const pts = d ? dartPts(d) : null;
        return (
          <button
            key={i}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onSlotClick?.(i)}
            className={cn(
              "flex flex-col items-center justify-center rounded-lg border font-bold transition",
              compact ? "h-11 w-14 text-sm" : "h-14 w-16 text-base",
              d
                ? "border-[rgb(225_6_0/0.5)] bg-[#121212] text-[var(--brand-red-bright)]"
                : "border-dashed border-zinc-700 text-zinc-600",
              clickable && "active:scale-95 hover:border-[var(--brand-red)]"
            )}
          >
            <span>{d ? segmentLabel(d.kind, d.number) : "·"}</span>
            {showDartPoints && d && (
              <span
                className={cn(
                  "font-display text-[10px] tabular-nums",
                  pts && pts > 0 ? "text-zinc-300" : "text-zinc-600"
                )}
              >
                {pts && pts > 0 ? `+${pts}` : "0"}
              </span>
            )}
          </button>
        );
      })}
      <div className="ml-1 min-w-[2.5rem] text-center">
        <div className="font-display text-[9px] tracking-wider text-zinc-600">Σ</div>
        <div
          className={cn(
            "text-xl font-black tabular-nums",
            totalVoided ? "text-amber-400" : "text-white"
          )}
        >
          {total}
        </div>
      </div>
    </div>
  );
}
