"use client";

import { useEffect, useMemo, useState } from "react";
import {
  leaderboard,
  leaderboardByMode,
  type StoredPlayer,
} from "@/lib/storage";
import { formatAvg } from "@/lib/utils";

type Metric = "avg" | "wins" | "oneEighties" | "checkouts" | "highestCheckout";
type Board = "overall" | "killer";

export default function LeaderboardPage() {
  const [board, setBoard] = useState<Board>("overall");
  const [metric, setMetric] = useState<Metric>("avg");
  const [rows, setRows] = useState<StoredPlayer[]>([]);
  const [killerRows, setKillerRows] = useState<
    Array<{ playerId: string; name: string; matchesPlayed: number; matchesWon: number }>
  >([]);

  useEffect(() => {
    if (board === "killer") {
      setKillerRows(leaderboardByMode("killer", "wins"));
      return;
    }
    setRows(leaderboard(metric));
  }, [metric, board]);

  const title = useMemo(() => {
    if (board === "killer") return "Killer wins";
    const map: Record<Metric, string> = {
      avg: "Three-dart average",
      wins: "Match wins",
      oneEighties: "180s",
      checkouts: "Checkouts",
      highestCheckout: "Highest checkout",
    };
    return map[metric];
  }, [metric, board]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-black text-zinc-50">Leaderboard</h1>
        <p className="mt-1 text-zinc-500">
          Local standings · {title} · registered players only
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["overall", "Overall"],
            ["killer", "Killer"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setBoard(id)}
            className={board === id ? "chip chip-active" : "chip"}
          >
            {label}
          </button>
        ))}
      </div>

      {board === "overall" && (
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["avg", "Average"],
              ["wins", "Wins"],
              ["oneEighties", "180s"],
              ["checkouts", "Checkouts"],
              ["highestCheckout", "High out"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMetric(id)}
              className={metric === id ? "chip chip-active" : "chip"}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <ol className="space-y-2">
        {board === "killer" ? (
          <>
            {killerRows.length === 0 && (
              <li className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
                Win Killer with a PIN account to appear here. Guests play with no history.
              </li>
            )}
            {killerRows.map((p, i) => (
              <li
                key={p.playerId}
                className="flex items-center gap-4 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-5 py-4"
              >
                <RankBadge i={i} />
                <div className="flex-1">
                  <div className="font-bold text-zinc-50">{p.name}</div>
                  <div className="text-xs text-zinc-500">
                    {p.matchesPlayed} Killer match{p.matchesPlayed === 1 ? "" : "es"}
                  </div>
                </div>
                <div className="text-2xl font-black tabular-nums text-[var(--brand-red-bright)]">
                  {p.matchesWon}
                </div>
              </li>
            ))}
          </>
        ) : (
          <>
            {rows.length === 0 && (
              <li className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
                Play some matches to fill the board.
              </li>
            )}
            {rows.map((p, i) => {
              const avg =
                p.stats.dartsThrown > 0
                  ? (p.stats.totalScore / p.stats.dartsThrown) * 3
                  : p.stats.bestThreeDartAvg;
              const value =
                metric === "avg"
                  ? formatAvg(avg)
                  : metric === "wins"
                    ? p.stats.matchesWon
                    : metric === "oneEighties"
                      ? p.stats.oneEighties
                      : metric === "checkouts"
                        ? p.stats.checkoutsHit
                        : p.stats.highestCheckout;

              return (
                <li
                  key={p.id}
                  className="flex items-center gap-4 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-5 py-4"
                >
                  <RankBadge i={i} />
                  <div className="flex-1">
                    <div className="font-bold text-zinc-50">{p.name}</div>
                    <div className="text-xs text-zinc-500">
                      {p.stats.matchesPlayed} matches · best avg{" "}
                      {formatAvg(p.stats.bestThreeDartAvg)}
                    </div>
                  </div>
                  <div className="text-2xl font-black tabular-nums text-[var(--brand-red-bright)]">
                    {value}
                  </div>
                </li>
              );
            })}
          </>
        )}
      </ol>
    </div>
  );
}

function RankBadge({ i }: { i: number }) {
  return (
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black ${
        i === 0
          ? "bg-[var(--brand-red)] text-white"
          : i === 1
            ? "bg-[var(--panel-elevated)] text-white ring-1 ring-[var(--panel-border)]"
            : i === 2
              ? "bg-[var(--brand-red-dim)] text-red-100"
              : "bg-black text-zinc-400 ring-1 ring-[var(--panel-border)]"
      }`}
    >
      {i + 1}
    </div>
  );
}
