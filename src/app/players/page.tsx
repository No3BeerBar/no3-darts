"use client";

import { useEffect, useState } from "react";
import { usePlayersStore } from "@/store/players-store";
import { formatAvg } from "@/lib/utils";

export default function PlayersPage() {
  const store = usePlayersStore();
  const [name, setName] = useState("");

  useEffect(() => {
    store.hydrate();
  }, [store]);

  const saved = store.players.filter((p) => !p.isGuest);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-black text-zinc-50">Players</h1>
        <p className="mt-1 text-zinc-500">Saved profiles for No. 3 regulars</p>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          store.addPlayer(name.trim(), false);
          setName("");
        }}
      >
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Player name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn-primary">
          Add player
        </button>
      </form>

      <ul className="space-y-3">
        {saved.length === 0 && (
          <li className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
            No saved players yet — add regulars from the bar.
          </li>
        )}
        {saved.map((p) => {
          const avg =
            p.stats.dartsThrown > 0
              ? (p.stats.totalScore / p.stats.dartsThrown) * 3
              : 0;
          return (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-4"
            >
              <div>
                <div className="text-lg font-bold text-zinc-50">{p.name}</div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
                  <span>
                    Matches <strong className="text-zinc-300">{p.stats.matchesPlayed}</strong>
                  </span>
                  <span>
                    Wins <strong className="text-zinc-300">{p.stats.matchesWon}</strong>
                  </span>
                  <span>
                    Avg <strong className="text-[var(--brand-red-bright)]">{formatAvg(avg)}</strong>
                  </span>
                  <span>
                    180s <strong className="text-zinc-300">{p.stats.oneEighties}</strong>
                  </span>
                  <span>
                    High out{" "}
                    <strong className="text-zinc-300">{p.stats.highestCheckout || "—"}</strong>
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost text-red-300"
                onClick={() => {
                  if (confirm(`Remove ${p.name}?`)) store.removePlayer(p.id);
                }}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
