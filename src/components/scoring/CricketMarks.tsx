"use client";

import type { GameState, PlayerGameState } from "@/engine/types";
import { cn } from "@/lib/utils";

const DEFAULT_NUMBERS = [20, 19, 18, 17, 16, 15, 25];

function cricketNumbers(state: GameState): number[] {
  if (state.modeConfig.mode === "cricket" && state.modeConfig.config.numbers?.length) {
    return state.modeConfig.config.numbers;
  }
  return DEFAULT_NUMBERS;
}

function labelFor(n: number): string {
  return n === 25 ? "B" : String(n);
}

/** Classic cricket mark glyphs: empty · / · X · ⦻ */
function markGlyph(count: number): string {
  const c = Math.min(3, Math.max(0, count));
  if (c === 0) return "·";
  if (c === 1) return "/";
  if (c === 2) return "X";
  return "⊗";
}

/**
 * Compact per-player mark row: 20 19 18 17 16 15 B with / X closed marks.
 */
export function CricketMarksRow({
  marks,
  numbers,
  compact = false,
  className,
}: {
  marks: Record<number, number>;
  numbers: number[];
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-0.5",
        className
      )}
      style={{ gridTemplateColumns: `repeat(${numbers.length}, minmax(0, 1fr))` }}
    >
      {numbers.map((n) => {
        const m = marks[n] ?? 0;
        const closed = m >= 3;
        return (
          <div
            key={n}
            className={cn(
              "flex flex-col items-center rounded-md border",
              compact ? "px-0.5 py-0.5" : "px-1 py-1",
              closed
                ? "border-[rgb(225_6_0/0.45)] bg-[rgb(225_6_0/0.15)]"
                : "border-zinc-800/80 bg-zinc-950/50"
            )}
          >
            <span
              className={cn(
                "font-display tracking-wider text-zinc-500",
                compact ? "text-[8px]" : "text-[10px]"
              )}
            >
              {labelFor(n)}
            </span>
            <span
              className={cn(
                "font-black leading-none",
                compact ? "text-sm" : "text-base",
                closed ? "text-[var(--brand-red-bright)]" : m > 0 ? "text-white" : "text-zinc-700"
              )}
            >
              {markGlyph(m)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Full cricket board matrix for TV: header numbers + one row per player.
 */
export function CricketScoreboard({
  state,
  className,
  size = "md",
}: {
  state: GameState;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const numbers = cricketNumbers(state);
  const isLg = size === "lg";
  const isSm = size === "sm";

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-center">
        <thead>
          <tr>
            <th
              className={cn(
                "font-display tracking-wider text-zinc-600",
                isLg ? "px-2 pb-2 text-xs" : isSm ? "px-1 pb-1 text-[9px]" : "px-1.5 pb-1.5 text-[10px]"
              )}
            />
            {numbers.map((n) => (
              <th
                key={n}
                className={cn(
                  "font-display font-semibold tracking-wider text-zinc-400",
                  isLg ? "px-2 pb-2 text-sm" : isSm ? "px-1 pb-1 text-[10px]" : "px-1.5 pb-1.5 text-xs"
                )}
              >
                {labelFor(n)}
              </th>
            ))}
            <th
              className={cn(
                "font-display tracking-wider text-zinc-500",
                isLg ? "px-2 pb-2 text-xs" : "px-1.5 pb-1.5 text-[10px]"
              )}
            >
              PTS
            </th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            // One row per team when doubles
            const seen = new Set<string>();
            const rows: Array<{
              key: string;
              label: string;
              sub?: string;
              ps: PlayerGameState;
              active: boolean;
              thrower?: string;
            }> = [];
            for (const p of state.players) {
              const ps = state.playerStates.find((s) => s.playerId === p.id)!;
              const tid = ps.teamId ?? p.id;
              if (seen.has(tid)) continue;
              seen.add(tid);
              const team = state.teams?.find((t) => t.id === tid);
              const mates = team
                ? team.playerIds.map((id) => state.players.find((x) => x.id === id)?.name ?? "")
                : [p.name];
              const active =
                team?.playerIds.includes(state.players[state.currentPlayerIndex]?.id ?? "") ||
                (!team && state.players[state.currentPlayerIndex]?.id === p.id);
              const thrower =
                active && state.status === "playing"
                  ? state.players[state.currentPlayerIndex]?.name
                  : undefined;
              rows.push({
                key: tid,
                label: team && team.playerIds.length > 1 ? team.name : p.name,
                sub: team && team.playerIds.length > 1 ? mates.join(" · ") : undefined,
                ps,
                active: Boolean(active) && state.status === "playing",
                thrower,
              });
            }
            return rows.map((row) => (
              <tr key={row.key} className={cn(row.active && "bg-[rgb(225_6_0/0.1)]")}>
                <td
                  className={cn(
                    "truncate text-left font-display tracking-wider",
                    isLg ? "max-w-[10rem] py-2 pr-3 text-sm" : "max-w-[6rem] py-1 pr-2 text-[11px]",
                    row.active ? "text-white" : "text-zinc-400"
                  )}
                >
                  <div>{row.label}</div>
                  {row.sub && (
                    <div className="text-[10px] font-normal tracking-normal text-zinc-600">
                      {row.sub}
                      {row.thrower ? ` · ${row.thrower}` : ""}
                    </div>
                  )}
                  {!row.sub && row.thrower && (
                    <span className="ml-1.5 text-[9px] text-[var(--brand-red-bright)]">●</span>
                  )}
                </td>
                {numbers.map((n) => {
                  const m = row.ps.marks?.[n] ?? 0;
                  const closed = m >= 3;
                  return (
                    <td key={n} className={isLg ? "py-2" : "py-1"}>
                      <span
                        className={cn(
                          "inline-flex items-center justify-center rounded-md font-black",
                          isLg ? "h-10 w-10 text-xl" : isSm ? "h-7 w-7 text-sm" : "h-8 w-8 text-base",
                          closed
                            ? "bg-[rgb(225_6_0/0.2)] text-[var(--brand-red-bright)] ring-1 ring-[rgb(225_6_0/0.45)]"
                            : m > 0
                              ? "text-white"
                              : "text-zinc-700"
                        )}
                      >
                        {markGlyph(m)}
                      </span>
                    </td>
                  );
                })}
                <td
                  className={cn(
                    "font-black tabular-nums",
                    isLg ? "py-2 pl-2 text-2xl" : "py-1 pl-1 text-lg",
                    row.active ? "text-[var(--brand-red-bright)]" : "text-white"
                  )}
                >
                  {row.ps.score}
                </td>
              </tr>
            ));
          })()}
        </tbody>
      </table>
    </div>
  );
}

export function getCricketNumbers(state: GameState): number[] {
  return cricketNumbers(state);
}

export function playerMarks(ps: PlayerGameState): Record<number, number> {
  return ps.marks ?? {};
}
