"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LaneOverview, TournamentSummary } from "@/lib/tournament";
import { tournamentStaffFetch } from "@/lib/tournament/staff-fetch";
import { LaneOverviewPanel } from "@/components/tournament/LaneOverview";
import { useSettingsStore } from "@/store/settings-store";

export default function TournamentListPage() {
  const router = useRouter();
  const settings = useSettingsStore();
  const [list, setList] = useState<TournamentSummary[]>([]);
  const [lanes, setLanes] = useState<LaneOverview[]>([]);
  const [dbAvailable, setDbAvailable] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settings.hydrate();
  }, [settings]);

  const refresh = useCallback(() => {
    void fetch("/api/tournaments")
      .then((r) => r.json())
      .then(
        (data: {
          tournaments?: TournamentSummary[];
          dbAvailable?: boolean;
        }) => {
          setList(data.tournaments ?? []);
          setDbAvailable(data.dbAvailable ?? false);
        }
      )
      .catch(() => {
        setList([]);
        setDbAvailable(false);
      });

    void fetch("/api/tournaments/lanes")
      .then((r) => r.json())
      .then((data: { lanes?: LaneOverview[] }) => setLanes(data.lanes ?? []))
      .catch(() => setLanes([]));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const onCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await tournamentStaffFetch("/api/tournaments", {
        method: "POST",
        staffPin: settings.staffPin,
        body: JSON.stringify({
          name: name.trim() || `Tournament ${new Date().toLocaleDateString()}`,
          format: {
            legsToWin: 2,
            legModePolicy: "fixed",
            allowedModes: ["x01"],
            fixedModeConfig: {
              mode: "x01",
              config: { startScore: 501, doubleIn: false, doubleOut: true },
            },
          },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; tournament?: { id: string }; error?: string };
      if (!res.ok || !data.tournament) {
        throw new Error(data.error ?? "Create failed");
      }
      router.push(`/tournament/${data.tournament.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div>
        <h1 className="font-logo text-3xl text-white">Tournament</h1>
        <p className="mt-1 text-zinc-500">
          Staff only · single-elim · 3 lanes · flexible legs / games
        </p>
      </div>

      {dbAvailable === false && (
        <div className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          Postgres unavailable — tournaments need{" "}
          <code className="text-amber-100">DATABASE_URL</code> so all three boards share state. Casual
          play still works.
        </div>
      )}

      <section className="space-y-3">
        <h2 className="section-title">Lanes</h2>
        <LaneOverviewPanel lanes={lanes} />
      </section>

      <section className="panel-card space-y-3 p-6">
        <h2 className="section-title">New tournament</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Friday night bracket"
          className="w-full rounded-lg border border-[var(--panel-border)] bg-black px-3 py-3 text-white outline-none focus:border-[var(--brand-red)]"
        />
        {error && <p className="text-sm text-amber-300">{error}</p>}
        <button
          type="button"
          disabled={creating || dbAvailable === false}
          onClick={() => void onCreate()}
          className="btn-primary min-h-11 px-5"
        >
          {creating ? "Creating…" : "Create draft"}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">All tournaments</h2>
        {list.length === 0 ? (
          <p className="text-sm text-zinc-500">No tournaments yet.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tournament/${t.id}`}
                  className="flex items-center justify-between rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3 active:bg-black"
                >
                  <div>
                    <div className="font-display text-base text-white">{t.name}</div>
                    <div className="text-xs text-zinc-500">
                      {t.playerCount} players · {t.matchCount} matches ·{" "}
                      {new Date(t.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span
                    className={
                      t.status === "active"
                        ? "font-display text-xs tracking-wider text-emerald-400"
                        : t.status === "completed"
                          ? "font-display text-xs tracking-wider text-zinc-500"
                          : "font-display text-xs tracking-wider text-amber-300"
                    }
                  >
                    {t.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
