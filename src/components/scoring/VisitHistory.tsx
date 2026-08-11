"use client";

/**
 * Recent completed visits (previous rounds / turns).
 * Newest first — scroll horizontally on tablet.
 *
 * Fixed min-height so the board stage does not jump ~25px when the first
 * visit appears (empty placeholder vs scroll strip used to differ in height).
 *
 * Visit Σ uses mode rules via `visitPointsFromTurn` (not raw dart.value) so
 * Baseball / future non-X01 modes match the current-visit TurnDarts total.
 */

import {
  getTeamForPlayer,
  segmentLabel,
  visitPointsFromTurn,
  type GameState,
  type Turn,
} from "@/engine";
import { cn } from "@/lib/utils";

function dartLine(turn: Turn): string {
  if (turn.darts.length === 0) return "—";
  return turn.darts.map((d) => segmentLabel(d.kind, d.number)).join(" ");
}

/** Reserved strip height — label + visit cards / empty state (incl. scrollbar gutter). */
const STRIP_MIN_H = "min-h-[5.75rem]";

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
            "flex h-[4.5rem] items-center justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-3 text-center text-sm text-zinc-600"
          )}
        >
          No previous visits yet
        </div>
      ) : (
        <div className="-mx-1 flex h-[4.5rem] gap-2 overflow-x-auto overflow-y-hidden px-1 pb-1">
          {recent.map((turn, i) => {
            const player = state.players.find((p) => p.id === turn.playerId);
            const team = getTeamForPlayer(state, turn.playerId);
            const total = visitPointsFromTurn(state.mode, turn);
            const showScorePath =
              state.mode === "x01" || state.mode === "random_checkout";

            return (
              <div
                key={`${turn.timestamp}-${turn.playerId}-${i}`}
                className={cn(
                  "flex h-full shrink-0 flex-col justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--panel)]",
                  sm
                    ? "min-w-[7.5rem] px-2.5 py-1.5"
                    : lg
                      ? "min-w-[11rem] px-4 py-2"
                      : "min-w-[9rem] px-3 py-1.5",
                  turn.bust && "border-zinc-700 opacity-80",
                  turn.checkout && "border-[rgb(225_6_0/0.45)]"
                )}
              >
                {team && team.playerIds.length > 1 && (
                  <div
                    className={cn(
                      "truncate font-display font-semibold tracking-wide text-[var(--brand-red-bright)]",
                      lg ? "text-sm" : "text-xs"
                    )}
                  >
                    {team.name}
                  </div>
                )}
                <div
                  className={cn(
                    "truncate font-semibold text-white",
                    lg ? "text-base" : sm ? "text-sm" : "text-[15px]"
                  )}
                >
                  {player?.name ?? "?"}
                </div>
                <div
                  className={cn(
                    "mt-0.5 font-mono text-zinc-400",
                    lg ? "text-sm" : "text-xs"
                  )}
                >
                  {dartLine(turn)}
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "font-black tabular-nums",
                      turn.bust
                        ? "text-zinc-500"
                        : turn.checkout
                          ? "text-[var(--brand-red-bright)]"
                          : "text-white",
                      lg ? "text-2xl" : "text-xl"
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
