"use client";

import { useEffect, useMemo, useState } from "react";
import { leaderboard, type StoredPlayer } from "@/lib/storage";
import { formatAvg } from "@/lib/utils";

type Metric = "avg" | "wins" | "oneEighties" | "checkouts" | "highestCheckout";

export default function LeaderboardPage() {
  const [metric, setMetric] = useState<Metric>("avg");
  const [rows, setRows] = useState<StoredPlayer[]>([]);

  useEffect(() => {
    setRows(leaderboard(metric));
  }, [metric]);

  const title = useMemo(() => {
    const map: Record<Metric, string> = {
      avg: "Three-dart average",
      wins: "Match wins",
      oneEighties: "180s",
      checkouts: "Checkouts",
      highestCheckout: "Highest checkout",
    };
    return map[metric];
  }, [metric]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-black text-zinc-50">Leaderboard</h1>
        <p className="mt-1 text-zinc-500">Local standings · {title}</p>
      </div>

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

      <ol className="space-y-2">
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
              className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-4"
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black ${
                  i === 0
                    ? "bg-[var(--brand-red)] text-zinc-950"
                    : i === 1
                      ? "bg-zinc-300 text-zinc-900"
                      : i === 2
                        ? "bg-[var(--brand-red-dim)] text-red-100"
                        : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {i + 1}
              </div>
              <div className="flex-1">
                <div className="font-bold text-zinc-50">{p.name}</div>
                <div className="text-xs text-zinc-500">
                  {p.stats.matchesPlayed} matches · best avg {formatAvg(p.stats.bestThreeDartAvg)}
                </div>
              </div>
              <div className="text-2xl font-black tabular-nums text-[var(--brand-red-bright)]">{value}</div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
