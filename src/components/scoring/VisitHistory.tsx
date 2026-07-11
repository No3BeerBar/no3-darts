"use client";

/**
 * Recent completed visits (previous rounds / turns).
 * Newest first — scroll horizontally on tablet.
 */

import { getTeamForPlayer, segmentLabel, type GameState, type Turn } from "@/engine";
import { cn } from "@/lib/utils";

function visitTotal(turn: Turn): number {
  if (turn.bust) return 0;
  return turn.darts.reduce((a, d) => a + d.value, 0);
}

function dartLine(turn: Turn): string {
  if (turn.darts.length === 0) return "—";
  return turn.darts.map((d) => segmentLabel(d.kind, d.number)).join(" ");
}

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
  if (recent.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-zinc-800/60 bg-zinc-950/40 px-3 py-2 text-center text-sm text-zinc-600",
          className
        )}
      >
        No previous visits yet
      </div>
    );
  }

  const lg = size === "lg";
  const sm = size === "sm";

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "mb-1.5 font-display tracking-[0.2em] text-zinc-500",
          lg ? "text-xs" : "text-[10px]"
        )}
      >
        RECENT VISITS
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {recent.map((turn, i) => {
          const player = state.players.find((p) => p.id === turn.playerId);
          const team = getTeamForPlayer(state, turn.playerId);
          const total = visitTotal(turn);
          const showScorePath =
            state.mode === "x01" || state.mode === "random_checkout";

          return (
            <div
              key={`${turn.timestamp}-${turn.playerId}-${i}`}
              className={cn(
                "shrink-0 rounded-xl border border-zinc-800 bg-[#121212]/90",
                sm ? "min-w-[7.5rem] px-2.5 py-2" : lg ? "min-w-[11rem] px-4 py-3" : "min-w-[9rem] px-3 py-2.5",
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
                  "mt-1 font-mono text-zinc-400",
                  lg ? "text-sm" : "text-xs"
                )}
              >
                {dartLine(turn)}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
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
                  {turn.bust ? "BUST" : turn.checkout ? "OUT" : total}
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
    </div>
  );
}
