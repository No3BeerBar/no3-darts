"use client";

import {
  baseballDartPoints,
  baseballInning,
  baseballTarget,
  type GameState,
} from "@/engine";
import { cn } from "@/lib/utils";

/** Compact inning / target / last-dart strip for tablet + TV Baseball. */
export function BaseballBanner({
  state,
  size = "sm",
}: {
  state: GameState;
  size?: "sm" | "lg";
}) {
  if (state.mode !== "baseball") return null;

  const inning = baseballInning(state);
  const target = baseballTarget(state);
  const last = state.currentTurnDarts[state.currentTurnDarts.length - 1];
  const lastPts = last ? baseballDartPoints(last, inning) : null;
  const lg = size === "lg";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgb(225_6_0/0.35)] bg-[rgb(225_6_0/0.08)]",
        lg ? "px-5 py-4" : "px-3 py-2"
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <div
            className={cn(
              "font-display tracking-[0.25em] text-zinc-500",
              lg ? "text-xs" : "text-[10px]"
            )}
          >
            INNING
          </div>
          <div
            className={cn(
              "font-black tabular-nums text-white",
              lg ? "text-4xl" : "text-2xl"
            )}
          >
            {inning}
            <span className="ml-1 text-base font-semibold text-zinc-600">/ 9</span>
          </div>
        </div>
        <div>
          <div
            className={cn(
              "font-display tracking-[0.25em] text-zinc-500",
              lg ? "text-xs" : "text-[10px]"
            )}
          >
            TARGET
          </div>
          <div
            className={cn(
              "font-black tabular-nums text-[var(--brand-red-bright)]",
              lg ? "text-4xl" : "text-2xl"
            )}
          >
            {target}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div
          className={cn(
            "font-display tracking-[0.25em] text-zinc-500",
            lg ? "text-xs" : "text-[10px]"
          )}
        >
          LAST DART
        </div>
        <div
          className={cn(
            "font-black tabular-nums",
            lg ? "text-4xl" : "text-2xl",
            lastPts != null && lastPts > 0
              ? "text-[var(--brand-red-bright)]"
              : "text-zinc-500"
          )}
        >
          {lastPts == null ? "—" : lastPts > 0 ? `+${lastPts}` : "0"}
        </div>
      </div>
    </div>
  );
}
