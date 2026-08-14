"use client";

/**
 * Recent completed visits (previous rounds / turns).
 * Newest first — scroll horizontally on tablet.
 *
 * Every visit (and each dart listed in it) shows who threw. Cards are large
 * enough to read — not a tiny unlabeled dart list.
 *
 * Reserved min-height so the board stage does not jump when the first visit
 * appears (empty placeholder vs scroll strip).
 *
 * Visit Σ uses mode rules via `visitPointsFromTurn` (not raw dart.value) so
 * Baseball / future non-X01 modes match the current-visit TurnDarts total.
 */

import {
  segmentLabel,
  visitPointsFromTurn,
  type DartThrow,
  type GameState,
} from "@/engine";
import { visitThrowerLabel, visitThrowerName } from "@/lib/visit-thrower";
import { cn } from "@/lib/utils";

/** Reserved strip height — label + visit cards / empty state (incl. scrollbar gutter). */
const STRIP_MIN_H = "min-h-[11.5rem]";

export function VisitHistory({
  state,
  limit = 10,
  className,
  size = "md",
}: {
  state: GameState;
  limit?: number;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const recent = [...state.turns].reverse().slice(0, limit);
  const lg = size === "lg";
  const sm = size === "sm";

  return (
    <div className={cn("w-full shrink-0", STRIP_MIN_H, className)}>
      <div
        className={cn(
          "mb-1.5 font-display tracking-[0.2em] text-zinc-500",
          lg ? "text-xs" : "text-[10px]"
        )}
      >
        RECENT VISITS
      </div>
      {recent.length === 0 ? (
        <div
          className={cn(
            "flex h-[9.5rem] items-center justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-3 text-center text-sm text-zinc-600"
          )}
        >
          No previous visits yet
        </div>
      ) : (
        <div className="-mx-1 flex min-h-[9.5rem] gap-2 overflow-x-auto overflow-y-hidden px-1 pb-1">
          {recent.map((turn, i) => {
            const thrower = visitThrowerName(state, turn);
            const label = visitThrowerLabel(state, turn);
            const total = visitPointsFromTurn(state.mode, turn);
            const showScorePath =
              state.mode === "x01" || state.mode === "random_checkout";
            const darts: Array<DartThrow | null> =
              turn.darts.length > 0 ? turn.darts : [null];

            return (
              <div
                key={`${turn.timestamp}-${turn.playerId}-${i}`}
                data-testid="recent-visit"
                className={cn(
                  "flex shrink-0 flex-col justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--panel)]",
                  sm
                    ? "min-w-[13.5rem] px-3 py-2"
                    : lg
                      ? "min-w-[16rem] px-4 py-2.5"
                      : "min-w-[14.5rem] px-3.5 py-2",
                  turn.bust && "border-zinc-700 opacity-80",
                  turn.checkout && "border-[rgb(225_6_0/0.45)]"
                )}
              >
                <div
                  data-testid="recent-visit-thrower"
                  className={cn(
                    "truncate font-display font-bold tracking-wide text-white",
                    lg ? "text-xl" : sm ? "text-base" : "text-lg"
                  )}
                  title={label}
                >
                  {label}
                </div>
                <div className="mt-1.5 space-y-0.5">
                  {darts.map((d, di) => (
                    <div
                      key={d?.id ?? `empty-${di}`}
                      data-testid="recent-visit-dart"
                      className={cn(
                        "flex items-baseline justify-between gap-3",
                        lg ? "text-sm" : "text-[13px]"
                      )}
                    >
                      <span className="min-w-0 truncate font-display font-semibold text-zinc-300">
                        {thrower}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-zinc-400">
                        {d ? segmentLabel(d.kind, d.number) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "font-black tabular-nums",
                      turn.bust
                        ? "text-zinc-500"
                        : turn.checkout
                          ? "text-[var(--brand-red-bright)]"
                          : "text-white",
                      lg ? "text-3xl" : "text-2xl"
                    )}
                  >
                    {turn.bust
                      ? state.mode === "forty_one"
                        ? "HALVED"
                        : "BUST"
                      : turn.checkout
                        ? "OUT"
                        : state.mode === "forty_one"
                          ? `+${turn.endScore - turn.startScore}`
                          : total}
                  </span>
                  {showScorePath && !turn.bust && (
                    <span className="font-display text-[11px] tabular-nums text-zinc-600">
                      {turn.startScore}→{turn.endScore}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
