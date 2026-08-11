"use client";

/**
 * Blocks `/play` scoring until every registered (PIN) seat is re-verified.
 * Guests never appear here. Abort abandons the match (no stats).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthModal } from "@/components/auth/AuthModal";
import type { PlayerRef } from "@/engine/types";
import { PLAY_IDLE_HREF } from "@/lib/play-kiosk";
import { markSeatVerified, seatsNeedingReauth } from "@/lib/seat-auth";
import { useGameStore } from "@/store/game-store";
import { useSessionStore } from "@/store/session-store";

interface ResumeAuthGateProps {
  matchId: string;
  players: PlayerRef[];
  /** Bumps when seat auth changes so parent re-evaluates */
  onVerifiedChange: () => void;
}

export function ResumeAuthGate({ matchId, players, onVerifiedChange }: ResumeAuthGateProps) {
  const router = useRouter();
  const clearGame = useGameStore((s) => s.clearGame);
  const sessionPlayer = useSessionStore((s) => s.player);
  const sessionHydrated = useSessionStore((s) => s.hydrated);
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const needing = useMemo(() => {
    void tick;
    return seatsNeedingReauth(matchId, players, sessionPlayer?.id ?? null);
  }, [matchId, players, sessionPlayer?.id, tick]);

  if (!sessionHydrated) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85">
        <p className="font-display text-sm tracking-wide text-zinc-500">Checking sign-in…</p>
      </div>
    );
  }

  if (needing.length === 0) return null;

  const next = needing[0];

  const abort = () => {
    if (!confirm("Abort this match? Scores will not be saved.")) return;
    clearGame();
    router.replace(PLAY_IDLE_HREF);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/85 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Re-enter PIN to resume"
        className="w-full max-w-md rounded-2xl border border-[rgb(225_6_0/0.45)] bg-black p-4 shadow-2xl"
      >
        <h2 className="font-display text-lg tracking-wide text-white">Resume — PIN required</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Registered players must sign in again before scoring continues. Guests stay open.
        </p>

        <ul className="mt-3 space-y-1.5">
          {needing.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] px-3 py-2 text-sm"
            >
              <span className="font-semibold text-white">{p.name}</span>
              <span className="font-display text-[10px] tracking-wider text-[var(--brand-red-bright)]">
                Needs PIN
              </span>
            </li>
          ))}
        </ul>

        {error && (
          <div className="mt-3 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary min-h-12 flex-1"
            onClick={() => {
              setError(null);
              setAuthOpen(true);
            }}
          >
            Enter PIN · {next.name}
          </button>
          <button type="button" className="btn-ghost min-h-12 px-4 text-red-300" onClick={abort}>
            Abort match
          </button>
        </div>
      </div>

      <AuthModal
        open={authOpen}
        mode="unlock"
        initialName={next.name}
        onClose={() => setAuthOpen(false)}
        onSuccess={(player) => {
          if (player.id !== next.id) {
            setError(`That PIN is not for ${next.name}`);
            setAuthOpen(false);
            return;
          }
          // AuthModal may have just established the tablet session (Zustand is
          // sync; this component's sessionPlayer hook can still be stale null).
          // Bind the live session so a later cookie clear re-triggers the gate.
          const liveSessionId =
            useSessionStore.getState().player?.id ?? player.id;
          markSeatVerified(matchId, player.id, liveSessionId);
          setError(null);
          setTick((t) => t + 1);
          onVerifiedChange();
          setAuthOpen(false);
        }}
      />
    </div>
  );
}
