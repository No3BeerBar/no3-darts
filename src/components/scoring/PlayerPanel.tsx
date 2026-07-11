"use client";

import {
  getRemaining,
  isTeamGame,
  teamScoreRows,
  threeDartAverage,
  type GameState,
} from "@/engine";
import { cn, formatAvg } from "@/lib/utils";
import { CricketMarksRow, getCricketNumbers, playerMarks } from "./CricketMarks";

interface PlayerPanelProps {
  state: GameState;
  compact?: boolean;
}

function killerExtra(ps: { extra?: Record<string, unknown> }) {
  return {
    killerNumber: Number(ps.extra?.killerNumber ?? 0),
    lives: Number(ps.extra?.lives ?? 0),
    isKiller: Boolean(ps.extra?.isKiller),
    eliminated: Boolean(ps.extra?.eliminated),
  };
}

export function PlayerPanel({ state, compact = false }: PlayerPanelProps) {
  const isCricket = state.mode === "cricket";
  const cricketNums = isCricket ? getCricketNumbers(state) : [];
  const teams = isTeamGame(state);

  // Team games: one card per team — larger names & thrower callout
  if (teams && state.mode !== "killer") {
    const rows = teamScoreRows(state);
    return (
      <div
        className={cn(
          "grid gap-2.5",
          rows.length <= 2 && "grid-cols-1 sm:grid-cols-2",
          rows.length >= 3 && "grid-cols-1 sm:grid-cols-2"
        )}
      >
        {rows.map((row) => {
          const leadPs = state.playerStates.find(
            (p) => p.playerId === row.team.playerIds[0]
          )!;
          const thrower = row.throwerId
            ? state.players.find((p) => p.id === row.throwerId)
            : null;
          const rem =
            state.mode === "x01" || state.mode === "random_checkout"
              ? getRemaining(state, row.team.playerIds[0])
              : row.score;

          return (
            <div
              key={row.team.id}
              className={cn(
                "relative overflow-hidden rounded-2xl border px-3.5 transition",
                compact ? "py-2.5" : "py-3",
                row.active
                  ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.14)] shadow-[0_0_24px_rgb(225_6_0/0.22)]"
                  : "border-zinc-800/80 bg-[#121212]/95"
              )}
            >
              {row.active && (
                <div className="absolute left-0 top-0 h-full w-1 bg-[var(--brand-red)]" />
              )}

              {/* Team name — large */}
              <div
                className={cn(
                  "truncate font-display font-bold tracking-wide",
                  compact ? "text-base sm:text-lg" : "text-lg sm:text-xl",
                  row.active ? "text-white" : "text-zinc-200"
                )}
              >
                {row.team.name}
              </div>

              {/* Player names — larger */}
              <div
                className={cn(
                  "mt-0.5 truncate font-semibold",
                  compact ? "text-sm" : "text-base",
                  "text-zinc-400"
                )}
              >
                {row.playerNames.join("  ·  ")}
              </div>

              {/* Who throws */}
              {row.active && thrower ? (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-red)] px-3 py-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  <span className="font-display text-sm font-bold tracking-wide text-white">
                    {thrower.name} throws
                  </span>
                </div>
              ) : (
                <div className="mt-2 h-7" />
              )}

              {!isCricket && (
                <div
                  className={cn(
                    "mt-1 font-black tabular-nums leading-none",
                    compact ? "text-4xl" : "text-5xl sm:text-6xl",
                    row.active ? "text-[var(--brand-red-bright)]" : "text-white"
                  )}
                >
                  {state.mode === "x01" ? rem : row.score}
                </div>
              )}

              {isCricket && (
                <>
                  <div
                    className={cn(
                      "mt-1 font-black tabular-nums",
                      compact ? "text-2xl" : "text-3xl",
                      row.active ? "text-[var(--brand-red-bright)]" : "text-white"
                    )}
                  >
                    {row.score}
                    <span className="ml-1 text-base font-semibold text-zinc-500">pts</span>
                  </div>
                  <CricketMarksRow
                    marks={row.marks ?? playerMarks(leadPs)}
                    numbers={cricketNums}
                    compact={compact}
                    className="mt-2"
                  />
                </>
              )}

              {state.matchFormat.legsToWin > 1 && (
                <div className="mt-1.5 text-sm text-zinc-500">
                  Legs <strong className="text-zinc-300">{row.legsWon}</strong>
                  {state.matchFormat.setsToWin > 1 && (
                    <>
                      {" "}
                      · Sets <strong className="text-zinc-300">{row.setsWon}</strong>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Singles / FFA / killer
  return (
    <div
      className={cn(
        "grid gap-2.5",
        isCricket && state.players.length <= 2 && "grid-cols-1 sm:grid-cols-2",
        !isCricket && state.players.length <= 2 && "grid-cols-2",
        state.players.length === 3 && "grid-cols-1 sm:grid-cols-3",
        state.players.length >= 4 && "grid-cols-2 sm:grid-cols-4"
      )}
    >
      {state.players.map((p, idx) => {
        const ps = state.playerStates.find((s) => s.playerId === p.id)!;
        const active = idx === state.currentPlayerIndex && state.status === "playing";
        const remaining = getRemaining(state, p.id);
        const avg = threeDartAverage(ps);
        const k = state.mode === "killer" ? killerExtra(ps) : null;
        const display =
          state.mode === "cricket"
            ? ps.score
            : state.mode === "killer"
              ? k!.lives
              : remaining;

        return (
          <div
            key={p.id}
            className={cn(
              "relative overflow-hidden rounded-2xl border px-3.5 transition",
              compact ? "py-2.5" : "py-3",
              k?.eliminated && "opacity-40 border-zinc-800 bg-zinc-950/80",
              !k?.eliminated &&
                active &&
                "border-[var(--brand-red)] bg-[rgb(225_6_0/0.14)] shadow-[0_0_24px_rgb(225_6_0/0.22)]",
              !k?.eliminated && !active && "border-zinc-800/80 bg-[#121212]/95",
              k?.isKiller && !k.eliminated && !active && "border-red-900/50"
            )}
          >
            {active && !k?.eliminated && (
              <div className="absolute left-0 top-0 h-full w-1 bg-[var(--brand-red)]" />
            )}

            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div
                  className={cn(
                    "truncate font-display font-bold tracking-wide",
                    compact ? "text-base sm:text-lg" : "text-lg sm:text-xl",
                    active ? "text-white" : "text-zinc-200"
                  )}
                >
                  {p.name}
                </div>
                {active && !k?.eliminated && (
                  <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-red)] px-3 py-1">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    <span className="font-display text-sm font-bold tracking-wide text-white">
                      Throwing
                    </span>
                  </div>
                )}
              </div>
              {isCricket && (
                <span
                  className={cn(
                    "font-black tabular-nums",
                    compact ? "text-2xl" : "text-3xl",
                    active ? "text-[var(--brand-red-bright)]" : "text-white"
                  )}
                >
                  {ps.score}
                </span>
              )}
              {k?.isKiller && !k.eliminated && (
                <span className="rounded bg-red-700 px-2 py-0.5 text-xs font-bold text-white">
                  K
                </span>
              )}
              {k?.eliminated && (
                <span className="text-xs text-zinc-600">OUT</span>
              )}
            </div>

            {!isCricket && (
              <div
                className={cn(
                  "mt-1 font-black tabular-nums leading-none",
                  compact ? "text-4xl" : "text-5xl sm:text-6xl",
                  active && !k?.eliminated
                    ? "text-[var(--brand-red-bright)]"
                    : "text-white",
                  k?.eliminated && "text-zinc-600 line-through"
                )}
              >
                {display}
              </div>
            )}

            {isCricket && (
              <CricketMarksRow
                marks={playerMarks(ps)}
                numbers={cricketNums}
                compact={compact}
                className="mt-2"
              />
            )}

            {!compact && !isCricket && state.mode !== "killer" && (
              <div className="mt-1 text-sm text-zinc-500">
                avg {formatAvg(avg)}
                {ps.oneEighties > 0 && (
                  <span className="text-[var(--style-orange)]"> · {ps.oneEighties}×180</span>
                )}
              </div>
            )}
            {state.mode === "killer" && k && !k.eliminated && (
              <div className="mt-1 text-sm text-zinc-400">
                Number D{k.killerNumber}
                {!k.isKiller && " · need double to arm"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
