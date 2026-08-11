"use client";

import {
  computePlayerRoundStats,
  formatRoundStat,
  getBotProfile,
  getKillerExtra,
  getRemaining,
  isTeamGame,
  roundStatsForMode,
  teamScoreRows,
  threeDartAverage,
  type GameState,
} from "@/engine";
import { cn, formatAvg } from "@/lib/utils";
import { CricketMarksRow, getCricketNumbers, playerMarks } from "./CricketMarks";

function BotBadge({ difficulty }: { difficulty?: Parameters<typeof getBotProfile>[0] }) {
  const badge = difficulty ? getBotProfile(difficulty).badge : "BOT";
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 align-middle text-[9px] font-bold tracking-wider text-[var(--brand-red-bright)]">
      BOT · {badge}
    </span>
  );
}

interface PlayerPanelProps {
  state: GameState;
  compact?: boolean;
}

/** Live MPR / PPR line for a seat (mode-aware; multi-leg → current / overall). */
function RoundStatsLine({
  state,
  playerId,
  className,
}: {
  state: GameState;
  playerId: string;
  className?: string;
}) {
  const show = roundStatsForMode(state.mode);
  if (!show.mpr && !show.ppr) return null;
  const stats = computePlayerRoundStats(state, playerId);
  const multiLeg = state.matchFormat.legsToWin > 1;
  const parts: string[] = [];
  if (show.mpr) {
    const m = formatRoundStat(stats.mpr, multiLeg);
    if (m) parts.push(`MPR ${m}`);
  }
  if (show.ppr) {
    const p = formatRoundStat(stats.ppr, multiLeg);
    if (p) parts.push(`PPR ${p}`);
  }
  if (parts.length === 0) return null;
  return (
    <div
      className={cn(
        "font-semibold tabular-nums tracking-wide text-zinc-500",
        className
      )}
    >
      {parts.join(" · ")}
    </div>
  );
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
                  ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.12)]"
                  : "border-[var(--panel-border)] bg-[#0a0a0a]"
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
                {row.team.playerIds
                  .map((id) => {
                    const p = state.players.find((x) => x.id === id);
                    if (!p) return "?";
                    return p.isBot ? `${p.name} (bot)` : p.name;
                  })
                  .join("  ·  ")}
              </div>

              {/* Who throws */}
              {row.active && thrower ? (
                <div className="mt-1.5 inline-flex items-center gap-1.5 bg-[var(--brand-red)] px-2.5 py-0.5">
                  <span className="font-display text-xs font-bold tracking-wide text-white">
                    {thrower.name} throws
                  </span>
                </div>
              ) : (
                <div className="mt-1.5 h-6" />
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

              {(roundStatsForMode(state.mode).mpr ||
                roundStatsForMode(state.mode).ppr) && (
                <div
                  className={cn(
                    "mt-1.5 space-y-0.5",
                    compact ? "text-[11px]" : "text-xs"
                  )}
                >
                  {row.team.playerIds.map((pid, i) => (
                    <div
                      key={pid}
                      className="flex items-baseline justify-between gap-2"
                    >
                      {row.team.playerIds.length > 1 && (
                        <span className="truncate text-zinc-600">
                          {row.playerNames[i] ?? "—"}
                        </span>
                      )}
                      <RoundStatsLine
                        state={state}
                        playerId={pid}
                        className="shrink-0 text-[11px]"
                      />
                    </div>
                  ))}
                </div>
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

  // Singles / FFA / killer — dense grid; parent scrolls when many seats / Cricket marks
  return (
    <div
      className={cn(
        "grid gap-2",
        isCricket && state.players.length <= 2 && "grid-cols-1 sm:grid-cols-2",
        !isCricket && state.players.length <= 2 && "grid-cols-2",
        state.players.length === 3 && "grid-cols-3",
        state.players.length >= 4 && state.players.length <= 6 && "grid-cols-2 sm:grid-cols-3",
        state.players.length >= 7 && "grid-cols-2 sm:grid-cols-4"
      )}
    >
      {state.players.map((p, idx) => {
        const ps = state.playerStates.find((s) => s.playerId === p.id)!;
        const active = idx === state.currentPlayerIndex && state.status === "playing";
        const remaining = getRemaining(state, p.id);
        const avg = threeDartAverage(ps);
        const k = state.mode === "killer" ? getKillerExtra(ps) : null;
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
              "relative overflow-hidden rounded-xl border px-2.5 transition",
              compact ? "py-2" : "py-2.5",
              k?.eliminated && "opacity-40 border-[var(--panel-border)] bg-black",
              !k?.eliminated &&
                active &&
                "border-[var(--brand-red)] bg-[rgb(225_6_0/0.12)]",
              !k?.eliminated && !active && "border-[var(--panel-border)] bg-[#0a0a0a]",
              k?.isKiller && !k.eliminated && !active && "border-red-900/50"
            )}
          >
            {active && !k?.eliminated && (
              <div className="absolute left-0 top-0 h-full w-1 bg-[var(--brand-red)]" />
            )}

            <div className="flex items-start justify-between gap-1.5">
              <div className="min-w-0">
                <div
                  className={cn(
                    "truncate font-display font-bold tracking-wide",
                    compact ? "text-sm sm:text-base" : "text-base sm:text-lg",
                    active ? "text-white" : "text-zinc-200"
                  )}
                >
                  {p.name}
                  {p.isBot && <BotBadge difficulty={p.botDifficulty} />}
                </div>
                {active && !k?.eliminated && (
                  <div className="mt-1 inline-flex bg-[var(--brand-red)] px-2 py-0.5">
                    <span className="font-display text-[10px] font-bold tracking-wide text-white">
                      {p.isBot ? "Bot throwing" : "Throwing"}
                    </span>
                  </div>
                )}
              </div>
              {isCricket && (
                <span
                  className={cn(
                    "font-black tabular-nums",
                    compact ? "text-xl" : "text-2xl",
                    active ? "text-[var(--brand-red-bright)]" : "text-white"
                  )}
                >
                  {ps.score}
                </span>
              )}
              {k?.isKiller && !k.eliminated && (
                <span className="bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  K
                </span>
              )}
              {k?.eliminated && (
                <span className="text-[10px] text-zinc-600">OUT</span>
              )}
            </div>

            {!isCricket && (
              <div
                className={cn(
                  "mt-0.5 font-black tabular-nums leading-none",
                  compact ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl",
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
                compact
                className="mt-1.5"
              />
            )}

            <RoundStatsLine
              state={state}
              playerId={p.id}
              className={cn("mt-1", compact ? "text-[11px]" : "text-xs")}
            />
            {!compact && !isCricket && state.mode !== "killer" && !roundStatsForMode(state.mode).ppr && (
              <div className="mt-1 text-sm text-zinc-500">
                avg {formatAvg(avg)}
                {ps.oneEighties > 0 && (
                  <span className="text-[var(--style-orange)]"> · {ps.oneEighties}×180</span>
                )}
              </div>
            )}
            {state.mode === "killer" && k && !k.eliminated && (
              <div className="mt-1 text-xs text-zinc-400">
                D{k.killerNumber}
                {!k.isKiller && " · arm on double"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
