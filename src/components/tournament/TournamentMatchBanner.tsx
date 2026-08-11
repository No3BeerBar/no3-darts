"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameModeId, ModeConfig, PlayerRef } from "@/engine";
import type { TournamentFormat, TournamentMatch, TournamentPlayer } from "@/lib/tournament";
import { defaultModeConfig, resolveModeForLeg } from "@/lib/tournament";
import { useGameStore } from "@/store/game-store";
import { useSettingsStore } from "@/store/settings-store";
import { cn } from "@/lib/utils";

interface AssignedPayload {
  tournamentId: string;
  tournamentName: string;
  format: TournamentFormat;
  match: TournamentMatch;
  playerA: TournamentPlayer | null;
  playerB: TournamentPlayer | null;
}

const MODE_LABELS: Record<GameModeId, string> = {
  x01: "X01",
  cricket: "Cricket",
  shanghai: "Shanghai",
  countup: "Count-Up",
  around_the_clock: "Around Clock",
  bermuda: "Bermuda",
  random_checkout: "Checkout",
  killer: "Killer",
  baseball: "Baseball",
  forty_one: "41",
};

export function TournamentMatchBanner() {
  const router = useRouter();
  const startGame = useGameStore((s) => s.startGame);
  const active = useGameStore((s) => s.state);
  const settings = useSettingsStore();
  const [assigned, setAssigned] = useState<AssignedPayload | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const room = settings.roomName || "Board 1";

  const refresh = useCallback(() => {
    const q = encodeURIComponent(room);
    void fetch(`/api/tournaments/lanes/${q}`)
      .then((r) => r.json())
      .then((data: { ok?: boolean; assigned?: AssignedPayload | null }) => {
        setAssigned(data.assigned ?? null);
      })
      .catch(() => setAssigned(null));
  }, [room]);

  useEffect(() => {
    settings.hydrate();
  }, [settings]);

  useEffect(() => {
    if (active) return;
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [active, refresh]);

  if (active || !assigned?.playerA || !assigned?.playerB) return null;

  const startWithConfig = async (modeConfig: ModeConfig) => {
    setStarting(true);
    setError(null);
    try {
      const toRef = (p: TournamentPlayer): PlayerRef => ({
        id: p.registeredPlayerId ?? p.id,
        name: p.displayName,
        isGuest: p.isGuest || !p.registeredPlayerId,
      });

      // Guests need stable ids for the engine — use tournament player ids
      const players: PlayerRef[] = [
        {
          ...toRef(assigned.playerA!),
          id: assigned.playerA!.registeredPlayerId ?? assigned.playerA!.id,
        },
        {
          ...toRef(assigned.playerB!),
          id: assigned.playerB!.registeredPlayerId ?? assigned.playerB!.id,
        },
      ];

      // Killer needs numbers — auto-assign if missing
      let config = modeConfig;
      if (config.mode === "killer") {
        const nums: Record<string, number> = { ...config.config.playerNumbers };
        const pool = Array.from({ length: 20 }, (_, i) => i + 1);
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        players.forEach((p, i) => {
          if (nums[p.id] == null) nums[p.id] = pool[i];
        });
        config = { mode: "killer", config: { ...config.config, playerNumbers: nums } };
      }

      startGame({
        modeConfig: config,
        players,
        matchFormat: { legsToWin: assigned.format.legsToWin, setsToWin: 1 },
        roomId: room,
        tournamentMeta: {
          tournamentId: assigned.tournamentId,
          matchId: assigned.match.id,
          legModePolicy: assigned.format.legModePolicy,
          allowedModes: assigned.format.allowedModes,
          fixedModeConfig: assigned.format.fixedModeConfig,
          presetSequence: assigned.format.presetSequence,
          bracketPlayerAId: assigned.playerA!.id,
          bracketPlayerBId: assigned.playerB!.id,
        },
      });

      const state = useGameStore.getState().state;
      if (state?.id) {
        await fetch(
          `/api/tournaments/${assigned.tournamentId}/matches/${assigned.match.id}/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ liveGameId: state.id }),
          }
        );
      }
      router.push("/play");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start tournament match");
      setStarting(false);
    }
  };

  const onStart = () => {
    const resolved = resolveModeForLeg(assigned.format, 1);
    if (!resolved) {
      setPickMode(true);
      return;
    }
    void startWithConfig(resolved);
  };

  return (
    <div className="panel-card space-y-3 border-[var(--brand-red)] p-4">
      <div className="font-display text-[10px] tracking-widest text-[var(--brand-red-bright)]">
        Tournament match ready · {room}
      </div>
      <div className="font-logo text-xl text-white">
        {assigned.playerA.displayName}{" "}
        <span className="text-zinc-500">vs</span> {assigned.playerB.displayName}
      </div>
      <p className="text-sm text-zinc-400">
        {assigned.tournamentName} · {assigned.match.roundName} · first to{" "}
        {assigned.format.legsToWin} · {assigned.format.legModePolicy.replace(/_/g, " ")}
      </p>

      {pickMode && (
        <div className="flex flex-wrap gap-2">
          {assigned.format.allowedModes.map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={starting}
              onClick={() => void startWithConfig(defaultModeConfig(mode))}
              className="btn-ghost min-h-10 px-3 text-xs"
            >
              {MODE_LABELS[mode] ?? mode}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-amber-300">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {!pickMode && (
          <button
            type="button"
            disabled={starting}
            onClick={onStart}
            className="btn-primary min-h-11 px-5"
          >
            {starting ? "Starting…" : "Start tournament match"}
          </button>
        )}
        <button type="button" onClick={refresh} className="btn-ghost min-h-11 px-4">
          Refresh
        </button>
      </div>
    </div>
  );
}

export function LegModePicker({
  allowedModes,
  onPick,
  onCancel,
}: {
  allowedModes: GameModeId[];
  onPick: (config: ModeConfig) => void;
  onCancel?: () => void;
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="font-display text-xs tracking-wider text-zinc-400">
        Choose game for next leg
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {allowedModes.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onPick(defaultModeConfig(mode))}
            className={cn("btn-primary min-h-10 px-4 text-xs")}
          >
            {MODE_LABELS[mode] ?? mode}
          </button>
        ))}
      </div>
      {onCancel && (
        <button type="button" onClick={onCancel} className="btn-ghost min-h-9 px-3 text-xs">
          Cancel
        </button>
      )}
    </div>
  );
}
