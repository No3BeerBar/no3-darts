"use client";

import { useEffect, useState } from "react";
import { AuthModal, type AuthMode } from "@/components/auth/AuthModal";
import { usePlayersStore } from "@/store/players-store";
import { useSessionStore, type SessionPlayer } from "@/store/session-store";
import { formatAvg } from "@/lib/utils";

type HistoryRow = {
  matchId: string;
  finishedAt: number;
  modeLabel: string;
  won: boolean;
  avg: number;
};

export default function PlayersPage() {
  const store = usePlayersStore();
  const me = useSessionStore((s) => s.player);
  const logout = useSessionStore((s) => s.logout);
  const setPlayer = useSessionStore((s) => s.setPlayer);
  const hydrateSession = useSessionStore((s) => s.hydrate);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const playerId = me?.id;

  useEffect(() => {
    store.hydrate();
    void hydrateSession();
  }, [store, hydrateSession]);

  useEffect(() => {
    if (!playerId) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/players/${playerId}/stats`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: { ok: boolean; history?: HistoryRow[]; player?: SessionPlayer }) => {
        if (cancelled || !data.ok) return;
        setHistory(data.history ?? []);
        if (data.player) setPlayer(data.player);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [playerId, setPlayer]);

  const saved = store.players.filter((p) => !p.isGuest);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <AuthModal
        open={authOpen}
        mode={authMode}
        onClose={() => setAuthOpen(false)}
        onSuccess={(player) => {
          store.rememberRegistered(player);
          void store.syncFromServer();
          void hydrateSession();
        }}
      />

      <div>
        <h1 className="text-3xl font-black text-zinc-50">Players</h1>
        <p className="mt-1 text-zinc-500">
          Walk-up accounts · name + PIN · stats across every tablet
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {me ? (
          <>
            <div className="flex min-h-12 flex-1 items-center rounded-xl border border-[rgb(225_6_0/0.35)] bg-[rgb(225_6_0/0.1)] px-4 text-sm">
              Signed in as <strong className="ml-1 text-white">{me.name}</strong>
            </div>
            <button type="button" className="btn-ghost" onClick={() => void logout()}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setAuthMode("register");
                setAuthOpen(true);
              }}
            >
              Create account
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setAuthMode("signin");
                setAuthOpen(true);
              }}
            >
              Sign in
            </button>
          </>
        )}
      </div>

      {me && (
        <section className="space-y-3 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-5 py-4">
          <h2 className="font-display text-sm tracking-wider text-zinc-400">Your stats</h2>
          <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
            <span>
              Matches <strong className="text-zinc-200">{me.stats.matchesPlayed}</strong>
            </span>
            <span>
              Wins <strong className="text-zinc-200">{me.stats.matchesWon}</strong>
            </span>
            <span>
              Avg{" "}
              <strong className="text-[var(--brand-red-bright)]">
                {formatAvg(
                  me.stats.dartsThrown > 0
                    ? (me.stats.totalScore / me.stats.dartsThrown) * 3
                    : me.stats.bestThreeDartAvg
                )}
              </strong>
            </span>
            <span>
              180s <strong className="text-zinc-200">{me.stats.oneEighties}</strong>
            </span>
            <span>
              High out{" "}
              <strong className="text-zinc-200">{me.stats.highestCheckout || "—"}</strong>
            </span>
          </div>
          {history.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
              {history.slice(0, 10).map((h) => (
                <li key={h.matchId} className="flex justify-between gap-2">
                  <span>
                    {new Date(h.finishedAt).toLocaleDateString()} · {h.modeLabel}
                    {h.won ? " · Win" : ""}
                  </span>
                  <span className="tabular-nums text-zinc-400">avg {formatAvg(h.avg)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ul className="space-y-3">
        {saved.length === 0 && (
          <li className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
            No players yet — create a walk-up account at the board.
          </li>
        )}
        {saved.map((p) => {
          const avg =
            p.stats.dartsThrown > 0
              ? (p.stats.totalScore / p.stats.dartsThrown) * 3
              : 0;
          const registered = store.isRegistered(p.id);
          return (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-5 py-4"
            >
              <div>
                <div className="text-lg font-bold text-zinc-50">
                  {p.name}
                  {registered && (
                    <span className="ml-2 text-xs font-normal text-zinc-500">account</span>
                  )}
                  {me?.id === p.id && (
                    <span className="ml-2 text-xs font-normal text-[var(--brand-red-bright)]">
                      you
                    </span>
                  )}
                </div>
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
              {!registered && (
                <button
                  type="button"
                  className="btn-ghost text-red-300"
                  onClick={() => {
                    if (confirm(`Remove ${p.name}?`)) store.removePlayer(p.id);
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
