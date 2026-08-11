"use client";

import { getKillerExtra, getHandler, type GameState } from "@/engine";
import { cn } from "@/lib/utils";

/** Lives / arm status strip for tablet + TV Killer. */
export function KillerBanner({
  state,
  size = "sm",
}: {
  state: GameState;
  size?: "sm" | "lg";
}) {
  if (state.mode !== "killer") return null;

  const current = state.players[state.currentPlayerIndex];
  const ps = state.playerStates.find((p) => p.playerId === current?.id);
  const me = ps ? getKillerExtra(ps) : null;
  const status = getHandler("killer").getStatusLine?.(state) ?? "Killer";
  const lg = size === "lg";
  const alive = state.playerStates.filter((p) => !getKillerExtra(p).eliminated).length;

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
            YOUR NUMBER
          </div>
          <div
            className={cn(
              "font-black tabular-nums text-[var(--brand-red-bright)]",
              lg ? "text-4xl" : "text-2xl"
            )}
          >
            {me?.killerNumber ? `D${me.killerNumber}` : "—"}
          </div>
        </div>
        <div>
          <div
            className={cn(
              "font-display tracking-[0.25em] text-zinc-500",
              lg ? "text-xs" : "text-[10px]"
            )}
          >
            STATUS
          </div>
          <div
            className={cn(
              "font-black tracking-wide",
              lg ? "text-3xl" : "text-xl",
              me?.isKiller && !me.eliminated
                ? "text-[var(--brand-red-bright)]"
                : "text-white"
            )}
          >
            {me?.eliminated ? "OUT" : me?.isKiller ? "KILLER" : "ARM UP"}
          </div>
        </div>
        <div>
          <div
            className={cn(
              "font-display tracking-[0.25em] text-zinc-500",
              lg ? "text-xs" : "text-[10px]"
            )}
          >
            ALIVE
          </div>
          <div
            className={cn(
              "font-black tabular-nums text-white",
              lg ? "text-4xl" : "text-2xl"
            )}
          >
            {alive}
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
          HINT
        </div>
        <div
          className={cn(
            "max-w-[14rem] font-display font-semibold text-zinc-300",
            lg ? "text-base" : "text-sm"
          )}
        >
          {me?.eliminated
            ? "Waiting for the finish"
            : me?.isKiller
              ? "Hit their double to take a life — miss your own"
              : "Hit your double to become Killer"}
        </div>
        <div
          className={cn(
            "mt-1 font-display tracking-wider text-zinc-600",
            lg ? "text-xs" : "text-[10px]"
          )}
        >
          {status}
        </div>
      </div>
    </div>
  );
}
