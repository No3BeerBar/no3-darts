"use client";

import {
  fortyOneDartPoints,
  fortyOneExact41DartContributes,
  fortyOneRoundNumber,
  fortyOneTarget,
  fortyOneTargetLabel,
  FORTY_ONE_SEQUENCE,
  type GameState,
} from "@/engine";
import { cn } from "@/lib/utils";

/** Round / target / last-visit strip for tablet + TV mode 41. */
export function FortyOneBanner({
  state,
  size = "sm",
}: {
  state: GameState;
  size?: "sm" | "lg";
}) {
  if (state.mode !== "forty_one") return null;

  const target = fortyOneTarget(state);
  const round = fortyOneRoundNumber(state);
  const label = fortyOneTargetLabel(target);
  const last = state.currentTurnDarts[state.currentTurnDarts.length - 1];
  const lastPts = last ? fortyOneDartPoints(last, target) : null;
  const exact41Voided =
    target.type === "exact_41" &&
    state.currentTurnDarts.some((d) => !fortyOneExact41DartContributes(d));
  const visitSum =
    target.type === "exact_41"
      ? state.currentTurnDarts.reduce((a, d) => a + d.value, 0)
      : state.currentTurnDarts.reduce((a, d) => a + fortyOneDartPoints(d, target), 0);

  const lastTurn = state.turns[state.turns.length - 1];
  const lastVisitHalved = Boolean(lastTurn?.bust);
  const lastVisitBustOver =
    lastVisitHalved &&
    (lastTurn?.darts.reduce((a, d) => a + d.value, 0) ?? 0) > 41;
  const lastVisitPoints =
    lastTurn && !lastTurn.bust ? lastTurn.endScore - lastTurn.startScore : null;
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
            ROUND
          </div>
          <div
            className={cn(
              "font-black tabular-nums text-white",
              lg ? "text-4xl" : "text-2xl"
            )}
          >
            {round}
            <span className="ml-1 text-base font-semibold text-zinc-600">
              / {FORTY_ONE_SEQUENCE.length}
            </span>
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
              "font-black text-[var(--brand-red-bright)]",
              lg ? "text-3xl tracking-wide" : "text-xl tracking-wide",
              target.type === "exact_41" && "animate-pulse"
            )}
          >
            {label}
          </div>
          {target.type === "exact_41" && (
            <div
              className={cn(
                "font-display tracking-wider",
                lg ? "text-sm" : "text-[10px]",
                exact41Voided ? "text-amber-400" : "text-amber-400/90"
              )}
            >
              {exact41Voided
                ? "Miss voids visit · will HALVE"
                : "All 3 must score · exactly 41 · over ends the visit"}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4 text-right">
        {state.currentTurnDarts.length > 0 && (
          <div>
            <div
              className={cn(
                "font-display tracking-[0.25em] text-zinc-500",
                lg ? "text-xs" : "text-[10px]"
              )}
            >
              {target.type === "exact_41" ? "SUM" : "VISIT"}
            </div>
            <div
              className={cn(
                "font-black tabular-nums",
                lg ? "text-4xl" : "text-2xl",
                exact41Voided ? "text-amber-400" : "text-white"
              )}
            >
              {visitSum}
            </div>
          </div>
        )}
        <div>
          <div
            className={cn(
              "font-display tracking-[0.25em] text-zinc-500",
              lg ? "text-xs" : "text-[10px]"
            )}
          >
            {state.currentTurnDarts.length > 0 ? "LAST DART" : "LAST VISIT"}
          </div>
          <div
            className={cn(
              "font-black tabular-nums",
              lg ? "text-4xl" : "text-2xl",
              state.currentTurnDarts.length > 0
                ? lastPts != null && lastPts > 0
                  ? "text-[var(--brand-red-bright)]"
                  : "text-zinc-500"
                : lastVisitHalved
                  ? "text-amber-400"
                  : typeof lastVisitPoints === "number" && lastVisitPoints > 0
                    ? "text-[var(--brand-red-bright)]"
                    : "text-zinc-500"
            )}
          >
            {state.currentTurnDarts.length > 0
              ? lastPts == null
                ? "—"
                : target.type === "exact_41"
                  ? lastPts
                  : lastPts > 0
                    ? `+${lastPts}`
                    : "0"
              : lastVisitBustOver
                ? "BUST"
                : lastVisitHalved
                ? "HALVED"
                : typeof lastVisitPoints === "number" && lastVisitPoints > 0
                  ? `+${lastVisitPoints}`
                  : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
