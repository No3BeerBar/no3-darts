"use client";

import { useEffect, useState } from "react";
import { downloadBlob } from "@/lib/utils";
import { getMatches, matchToCsv, type StoredMatch } from "@/lib/storage";

export default function HistoryPage() {
  const [matches, setMatches] = useState<StoredMatch[]>([]);

  useEffect(() => {
    setMatches(getMatches());
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-black text-zinc-50">Match history</h1>
        <p className="mt-1 text-zinc-500">Export as JSON or CSV</p>
      </div>

      <ul className="space-y-3">
        {matches.length === 0 && (
          <li className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
            No finished matches yet.
          </li>
        )}
        {matches.map((m) => (
          <li
            key={m.id}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-bold text-zinc-50">
                  {m.players.map((p) => p.name).join(" · ")}
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                  {m.modeLabel || m.mode} ·{" "}
                  {new Date(m.finishedAt).toLocaleString()} · Winner:{" "}
                  <span className="text-[var(--brand-red-bright)]">{m.winnerName ?? "—"}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-400">
                  {m.summary.playerStats.map((ps) => (
                    <span key={ps.playerId} className="rounded-lg bg-zinc-950 px-2 py-1">
                      {ps.name}: avg {ps.avg} · {ps.oneEighties}×180
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    downloadBlob(
                      `match-${m.id}.json`,
                      JSON.stringify(m, null, 2),
                      "application/json"
                    )
                  }
                >
                  JSON
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    downloadBlob(`match-${m.id}.csv`, matchToCsv(m), "text/csv")
                  }
                >
                  CSV
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {matches.length > 0 && (
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            downloadBlob(
              "no3-darts-history.json",
              JSON.stringify(matches, null, 2),
              "application/json"
            )
          }
        >
          Export all JSON
        </button>
      )}
    </div>
  );
}
