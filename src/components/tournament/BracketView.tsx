"use client";

import type { Tournament, TournamentLane, TournamentMatch } from "@/lib/tournament";
import { TOURNAMENT_LANES } from "@/lib/tournament";
import { cn } from "@/lib/utils";

function playerName(t: Tournament, id: string | null): string {
  if (!id) return "TBD";
  return t.players.find((p) => p.id === id)?.displayName ?? "—";
}

function MatchCard({
  tournament,
  match,
  onAssign,
  busy,
}: {
  tournament: Tournament;
  match: TournamentMatch;
  onAssign?: (matchId: string, lane: TournamentLane | null) => void;
  busy?: boolean;
}) {
  const canAssign =
    Boolean(onAssign) &&
    match.status !== "complete" &&
    Boolean(match.playerAId && match.playerBId);

  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border px-3 py-2",
        match.status === "in_progress"
          ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.12)]"
          : match.status === "complete"
            ? "border-[var(--panel-border)] bg-black/60 opacity-80"
            : match.status === "ready"
              ? "border-emerald-800 bg-emerald-950/30"
              : "border-[var(--panel-border)] bg-[var(--panel)]"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[10px] tracking-wider text-zinc-500">
          {match.roundName}
        </span>
        <span className="font-display text-[10px] uppercase tracking-wider text-zinc-600">
          {match.status.replace("_", " ")}
        </span>
      </div>
      <div className="mt-1 space-y-0.5 font-display text-sm">
        <div
          className={cn(
            "truncate",
            match.winnerId === match.playerAId && match.status === "complete"
              ? "text-[var(--brand-red-bright)]"
              : "text-white"
          )}
        >
          {playerName(tournament, match.playerAId)}
        </div>
        <div
          className={cn(
            "truncate",
            match.winnerId === match.playerBId && match.status === "complete"
              ? "text-[var(--brand-red-bright)]"
              : "text-white"
          )}
        >
          {playerName(tournament, match.playerBId)}
        </div>
      </div>
      {match.lane && (
        <div className="mt-1 font-display text-[10px] tracking-wider text-zinc-400">
          {match.lane}
        </div>
      )}
      {canAssign && (
        <div className="mt-2 flex flex-wrap gap-1">
          {TOURNAMENT_LANES.map((lane) => (
            <button
              key={lane}
              type="button"
              disabled={busy}
              onClick={() => onAssign?.(match.id, lane)}
              className={cn(
                "rounded px-2 py-1 font-display text-[10px] tracking-wider",
                match.lane === lane
                  ? "bg-[var(--brand-red)] text-white"
                  : "bg-black text-zinc-400 ring-1 ring-[var(--panel-border)]"
              )}
            >
              {lane.replace("Board ", "B")}
            </button>
          ))}
          {match.lane && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAssign?.(match.id, null)}
              className="rounded px-2 py-1 font-display text-[10px] tracking-wider text-zinc-500"
            >
              Free
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function BracketView({
  tournament,
  onAssign,
  busy,
  tv,
}: {
  tournament: Tournament;
  onAssign?: (matchId: string, lane: TournamentLane | null) => void;
  busy?: boolean;
  tv?: boolean;
}) {
  const rounds = Array.from(new Set(tournament.matches.map((m) => m.roundIndex))).sort(
    (a, b) => a - b
  );

  return (
    <div className={cn("overflow-x-auto", tv && "pb-4")}>
      <div className="flex min-w-min gap-6 px-1 py-2">
        {rounds.map((r) => {
          const matches = tournament.matches
            .filter((m) => m.roundIndex === r)
            .sort((a, b) => a.bracketSlot - b.bracketSlot);
          return (
            <div key={r} className="flex flex-col justify-around gap-3">
              <div className="font-display text-xs tracking-widest text-zinc-500">
                {matches[0]?.roundName ?? `Round ${r}`}
              </div>
              {matches.map((m) => (
                <MatchCard
                  key={m.id}
                  tournament={tournament}
                  match={m}
                  onAssign={onAssign}
                  busy={busy}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
