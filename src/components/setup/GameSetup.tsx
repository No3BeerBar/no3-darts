"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameModeId, ModeConfig, PlayerRef } from "@/engine";
import {
  buildTeamsFromDraft,
  createId,
  modeSupportsTeams,
  validateKillerNumbers,
} from "@/engine";
import { useGameStore } from "@/store/game-store";
import { usePlayersStore } from "@/store/players-store";
import { useSettingsStore } from "@/store/settings-store";
import { cn } from "@/lib/utils";

const MODES: Array<{ id: GameModeId; name: string }> = [
  { id: "x01", name: "X01" },
  { id: "cricket", name: "Cricket" },
  { id: "shanghai", name: "Shanghai" },
  { id: "countup", name: "Count-Up" },
  { id: "around_the_clock", name: "Around Clock" },
  { id: "bermuda", name: "Bermuda" },
  { id: "random_checkout", name: "Checkout" },
  { id: "killer", name: "Killer" },
];

type PlayFormat = "singles" | "teams";

interface DraftTeam {
  key: string;
  name: string;
  /** 0–2 players */
  players: PlayerRef[];
}

function emptyTeam(n: number): DraftTeam {
  return { key: createId("draft"), name: `Team ${n}`, players: [] };
}

export function GameSetup() {
  const router = useRouter();
  const startGame = useGameStore((s) => s.startGame);
  const clearGame = useGameStore((s) => s.clearGame);
  const active = useGameStore((s) => s.state);
  const hydrateGame = useGameStore((s) => s.hydrate);
  const playersStore = usePlayersStore();
  const settings = useSettingsStore();

  const [mode, setMode] = useState<GameModeId>("x01");
  const [startScore, setStartScore] = useState<301 | 501 | 701 | 901>(501);
  const [doubleIn, setDoubleIn] = useState(false);
  const [doubleOut, setDoubleOut] = useState(true);
  const [cricketVariant, setCricketVariant] = useState<"standard" | "cutthroat">("standard");
  const [legsToWin, setLegsToWin] = useState(1);
  const [setsToWin, setSetsToWin] = useState(1);
  const [selected, setSelected] = useState<PlayerRef[]>([]);
  const [guestName, setGuestName] = useState("");
  const [countUpTurns, setCountUpTurns] = useState(8);
  const [killerLives, setKillerLives] = useState(3);
  const [killerNumbers, setKillerNumbers] = useState<Record<string, number>>({});
  const [setupError, setSetupError] = useState<string | null>(null);
  const [playFormat, setPlayFormat] = useState<PlayFormat>("singles");
  const [draftTeams, setDraftTeams] = useState<DraftTeam[]>([emptyTeam(1), emptyTeam(2)]);
  /** Player waiting to be placed on a team */
  const [holding, setHolding] = useState<PlayerRef | null>(null);

  const teamsAllowed = modeSupportsTeams(mode);
  const isTeams = teamsAllowed && playFormat === "teams";

  useEffect(() => {
    hydrateGame();
    playersStore.hydrate();
    settings.hydrate();
  }, [hydrateGame, playersStore, settings]);

  /** All players currently assigned to any team */
  const assignedIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of draftTeams) for (const p of t.players) s.add(p.id);
    return s;
  }, [draftTeams]);

  const freePlayers = useMemo(() => {
    const saved = playersStore.players.filter((p) => !p.isGuest);
    // guests only exist in selected / draft; collect guest-like from draft removals via holding only
    return saved.filter((p) => !assignedIds.has(p.id));
  }, [playersStore.players, assignedIds]);

  const teamPlayerCount = draftTeams.reduce((n, t) => n + t.players.length, 0);

  const togglePlayer = (p: PlayerRef) => {
    if (isTeams) {
      // In team mode, tapping a free player picks them up for placement
      if (assignedIds.has(p.id)) return;
      setHolding((h) => (h?.id === p.id ? null : p));
      setSetupError(null);
      return;
    }
    setSelected((prev) => {
      if (prev.some((x) => x.id === p.id)) {
        setKillerNumbers((nums) => {
          const next = { ...nums };
          delete next[p.id];
          return next;
        });
        return prev.filter((x) => x.id !== p.id);
      }
      if (prev.length >= 8) return prev;
      return [...prev, p];
    });
    setSetupError(null);
  };

  const placeOnTeam = (teamKey: string) => {
    if (!holding) return;
    setDraftTeams((prev) =>
      prev.map((t) => {
        if (t.key !== teamKey) return t;
        if (t.players.length >= 2) return t;
        if (t.players.some((p) => p.id === holding.id)) return t;
        return { ...t, players: [...t.players, holding] };
      })
    );
    setHolding(null);
    setSetupError(null);
  };

  const removeFromTeam = (teamKey: string, playerId: string) => {
    setDraftTeams((prev) =>
      prev.map((t) =>
        t.key === teamKey
          ? { ...t, players: t.players.filter((p) => p.id !== playerId) }
          : t
      )
    );
  };

  const addTeam = () => {
    if (draftTeams.length >= 4) return; // 4 teams × 2 = 8 players max
    setDraftTeams((prev) => [...prev, emptyTeam(prev.length + 1)]);
  };

  const removeTeam = (teamKey: string) => {
    setDraftTeams((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((t) => t.key !== teamKey);
    });
  };

  const renameTeam = (teamKey: string, name: string) => {
    setDraftTeams((prev) =>
      prev.map((t) => (t.key === teamKey ? { ...t, name } : t))
    );
  };

  const assignKillerNumber = (playerId: string, num: number) => {
    setKillerNumbers((prev) => {
      const next = { ...prev };
      for (const [pid, n] of Object.entries(next)) {
        if (n === num && pid !== playerId) delete next[pid];
      }
      next[playerId] = num;
      return next;
    });
    setSetupError(null);
  };

  const autoAssignKillerNumbers = () => {
    const pool = Array.from({ length: 20 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const next: Record<string, number> = {};
    selected.forEach((p, i) => {
      next[p.id] = pool[i];
    });
    setKillerNumbers(next);
    setSetupError(null);
  };

  const addGuest = () => {
    const name = guestName.trim() || `Guest ${Date.now() % 100}`;
    const g: PlayerRef = { id: createId("guest"), name, isGuest: true };
    if (isTeams) {
      setHolding(g);
    } else {
      setSelected((prev) => (prev.length >= 8 ? prev : [...prev, g]));
    }
    setGuestName("");
  };

  const buildConfig = (): ModeConfig => {
    switch (mode) {
      case "x01":
        return { mode: "x01", config: { startScore, doubleIn, doubleOut } };
      case "cricket":
        return { mode: "cricket", config: { variant: cricketVariant } };
      case "shanghai":
        return { mode: "shanghai", config: { maxRound: 20 } };
      case "countup":
        return { mode: "countup", config: { turns: countUpTurns } };
      case "around_the_clock":
        return {
          mode: "around_the_clock",
          config: { direction: "up", requireDouble: false, includeBull: true },
        };
      case "bermuda":
        return { mode: "bermuda", config: {} };
      case "random_checkout":
        return { mode: "random_checkout", config: { minScore: 41, maxScore: 170, attempts: 10 } };
      case "killer":
        return {
          mode: "killer",
          config: { lives: killerLives, playerNumbers: killerNumbers, doublesOnly: true },
        };
    }
  };

  const onStart = () => {
    if (mode === "killer") {
      if (selected.length < 2) return;
      const err = validateKillerNumbers(selected, killerNumbers);
      if (err) {
        setSetupError(err);
        return;
      }
    }

    try {
      if (isTeams) {
        const filled = draftTeams.filter((t) => t.players.length > 0);
        if (filled.length < 2) {
          setSetupError("Add at least 2 teams with players");
          return;
        }
        if (filled.some((t) => t.players.length < 1)) {
          setSetupError("Every team needs at least one player");
          return;
        }
        const { teams, players } = buildTeamsFromDraft(
          filled.map((t) => ({ name: t.name, players: t.players }))
        );
        startGame({
          modeConfig: buildConfig(),
          players,
          teams,
          matchFormat: { legsToWin, setsToWin },
          roomId: settings.roomName,
        });
      } else {
        if (selected.length < 1) return;
        startGame({
          modeConfig: buildConfig(),
          players: selected,
          matchFormat:
            mode === "killer" ? { legsToWin: 1, setsToWin: 1 } : { legsToWin, setsToWin },
          roomId: settings.roomName,
        });
      }
      router.push("/play");
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : "Could not start match");
    }
  };

  const onCancelMatch = () => {
    if (!active) return;
    if (confirm("Cancel this match? Scores will not be saved.")) {
      clearGame();
    }
  };

  const hasActive =
    active &&
    (active.status === "playing" ||
      active.status === "paused" ||
      active.status === "leg_won" ||
      active.status === "match_won");

  const canStart = isTeams
    ? draftTeams.filter((t) => t.players.length > 0).length >= 2 &&
      draftTeams.every((t) => t.players.length === 0 || t.players.length >= 1)
    : selected.length >= (mode === "killer" ? 2 : 1);

  return (
    <div className="space-y-3">
      {hasActive && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[rgb(225_6_0/0.4)] bg-[rgb(225_6_0/0.1)] p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-sm text-white">
              {active!.players.map((p) => p.name).join(" · ")}
            </div>
            <div className="text-xs text-zinc-500">{active!.mode}</div>
          </div>
          <button type="button" onClick={() => router.push("/play")} className="btn-primary min-h-11">
            Resume
          </button>
          <button type="button" onClick={onCancelMatch} className="btn-ghost min-h-11 text-red-300">
            Cancel
          </button>
        </div>
      )}

      <section>
        <h2 className="section-title mb-1.5">Mode</h2>
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                if (!modeSupportsTeams(m.id)) setPlayFormat("singles");
              }}
              className={cn("chip min-h-10 px-3 py-1.5 text-xs", mode === m.id && "chip-active")}
            >
              {m.name}
            </button>
          ))}
        </div>
      </section>

      {teamsAllowed && (
        <section>
          <h2 className="section-title mb-1.5">Format</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPlayFormat("singles");
                setHolding(null);
              }}
              className={cn("chip min-h-10", playFormat === "singles" && "chip-active")}
            >
              Singles
            </button>
            <button
              type="button"
              onClick={() => {
                setPlayFormat("teams");
                setHolding(null);
                setSelected([]);
              }}
              className={cn("chip min-h-10", playFormat === "teams" && "chip-active")}
            >
              Teams
            </button>
          </div>
          {isTeams && (
            <p className="mt-1.5 text-xs text-zinc-500">
              Up to 2 players per team · 2–4 teams · shared score · personal stats
            </p>
          )}
        </section>
      )}

      {mode === "x01" && (
        <div className="flex flex-wrap items-center gap-2">
          {([301, 501, 701, 901] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStartScore(s)}
              className={cn("chip min-h-10", startScore === s && "chip-active")}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDoubleIn((v) => !v)}
            className={cn("chip min-h-10", doubleIn && "chip-active")}
          >
            DI
          </button>
          <button
            type="button"
            onClick={() => setDoubleOut((v) => !v)}
            className={cn("chip min-h-10", doubleOut && "chip-active")}
          >
            DO
          </button>
        </div>
      )}

      {mode === "cricket" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCricketVariant("standard")}
            className={cn("chip min-h-10", cricketVariant === "standard" && "chip-active")}
          >
            Standard
          </button>
          <button
            type="button"
            onClick={() => setCricketVariant("cutthroat")}
            className={cn("chip min-h-10", cricketVariant === "cutthroat" && "chip-active")}
          >
            Cut-throat
          </button>
        </div>
      )}

      {mode === "countup" && (
        <div className="flex flex-wrap gap-2">
          {[5, 8, 10, 15].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setCountUpTurns(t)}
              className={cn("chip min-h-10", countUpTurns === t && "chip-active")}
            >
              {t} turns
            </button>
          ))}
        </div>
      )}

      {mode === "killer" && (
        <div className="space-y-2 rounded-xl border border-zinc-800 p-3">
          <div className="flex flex-wrap gap-2">
            {[3, 5, 7].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setKillerLives(n)}
                className={cn("chip min-h-10", killerLives === n && "chip-active")}
              >
                {n} lives
              </button>
            ))}
            <button type="button" className="btn-ghost min-h-10 text-xs" onClick={autoAssignKillerNumbers}>
              Auto #s
            </button>
          </div>
          {selected.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <span className="w-20 shrink-0 truncate text-sm font-semibold">{p.name}</span>
              <select
                className="input min-h-11 flex-1 py-2"
                value={killerNumbers[p.id] ?? ""}
                onChange={(e) => assignKillerNumber(p.id, parseInt(e.target.value, 10))}
              >
                <option value="">#</option>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                  <option
                    key={n}
                    value={n}
                    disabled={Object.entries(killerNumbers).some(
                      ([pid, num]) => num === n && pid !== p.id
                    )}
                  >
                    {n}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {mode !== "killer" && (
        <div className="flex flex-wrap gap-2">
          <span className="self-center font-display text-[10px] tracking-wider text-zinc-500">
            Legs
          </span>
          {[1, 2, 3].map((n) => (
            <button
              key={`l${n}`}
              type="button"
              onClick={() => setLegsToWin(n)}
              className={cn("chip min-h-10 px-3", legsToWin === n && "chip-active")}
            >
              {n}
            </button>
          ))}
          <span className="self-center font-display text-[10px] tracking-wider text-zinc-500">
            Sets
          </span>
          {[1, 2, 3].map((n) => (
            <button
              key={`s${n}`}
              type="button"
              onClick={() => setSetsToWin(n)}
              className={cn("chip min-h-10 px-3", setsToWin === n && "chip-active")}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {/* ——— TEAMS BUILDER ——— */}
      {isTeams ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="section-title">Teams ({teamPlayerCount} players)</h2>
            {holding && (
              <button
                type="button"
                className="btn-ghost min-h-9 text-xs"
                onClick={() => setHolding(null)}
              >
                Cancel pick
              </button>
            )}
          </div>

          {holding && (
            <div className="rounded-xl border border-[var(--brand-red)] bg-[rgb(225_6_0/0.12)] px-3 py-2 text-center text-sm">
              Place <strong className="text-[var(--brand-red-bright)]">{holding.name}</strong> — tap a
              team below
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {draftTeams.map((team, ti) => (
              <div
                key={team.key}
                className={cn(
                  "rounded-2xl border p-3 transition",
                  holding && team.players.length < 2
                    ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.08)]"
                    : "border-zinc-800 bg-[#121212]"
                )}
              >
                <label className="mb-2 block">
                  <span className="mb-1 block font-display text-[10px] tracking-wider text-zinc-500">
                    Team name
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      className="input min-h-12 flex-1 py-2 text-base font-bold"
                      value={team.name}
                      onChange={(e) => renameTeam(team.key, e.target.value)}
                      placeholder={`Team ${ti + 1}`}
                      maxLength={32}
                    />
                    {draftTeams.length > 2 && (
                      <button
                        type="button"
                        className="btn-ghost min-h-12 px-2 text-xs text-zinc-500"
                        onClick={() => removeTeam(team.key)}
                        aria-label="Remove team"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </label>

                {/* Two clear slots */}
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1].map((slot) => {
                    const p = team.players[slot];
                    if (p) {
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => removeFromTeam(team.key, p.id)}
                          className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-[rgb(225_6_0/0.4)] bg-[rgb(225_6_0/0.12)] px-2 py-2"
                        >
                          <span className="text-[10px] text-zinc-500">
                            {slot === 0 ? "Player 1" : "Partner"}
                          </span>
                          <span className="truncate text-sm font-bold text-white">{p.name}</span>
                          <span className="text-[10px] text-zinc-600">tap to remove</span>
                        </button>
                      );
                    }
                    const canDrop = holding && team.players.length < 2;
                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={!canDrop}
                        onClick={() => placeOnTeam(team.key)}
                        className={cn(
                          "flex min-h-14 flex-col items-center justify-center rounded-xl border border-dashed px-2 py-2",
                          canDrop
                            ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.06)] text-[var(--brand-red-bright)]"
                            : "border-zinc-700 text-zinc-600"
                        )}
                      >
                        <span className="text-[10px] uppercase tracking-wider">
                          {slot === 0 ? "Player 1" : "Partner"}
                        </span>
                        <span className="text-sm font-semibold">
                          {canDrop ? "Tap to add" : "Empty"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {draftTeams.length < 4 && (
            <button type="button" onClick={addTeam} className="btn-ghost min-h-11 w-full">
              + Add team
            </button>
          )}

          <div>
            <h3 className="section-title mb-1.5">
              {holding ? "Or pick someone else" : "Tap a player, then a team slot"}
            </h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {freePlayers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePlayer({ id: p.id, name: p.name, isGuest: false })}
                  className={cn(
                    "min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-semibold",
                    holding?.id === p.id
                      ? "border-[var(--brand-red)] bg-[var(--brand-red)] text-white"
                      : "border-zinc-800 bg-zinc-900"
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {freePlayers.length === 0 && !holding && (
              <p className="mt-2 text-center text-xs text-zinc-600">
                All saved players are on teams — add a guest or remove someone.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Guest name"
              className="input min-h-11 flex-1"
              onKeyDown={(e) => e.key === "Enter" && addGuest()}
            />
            <button type="button" onClick={addGuest} className="btn-ghost min-h-11 shrink-0">
              + Guest
            </button>
          </div>
        </section>
      ) : (
        /* ——— SINGLES / KILLER player pick ——— */
        <section>
          <h2 className="section-title mb-1.5">
            Players {selected.length > 0 ? `(${selected.length})` : ""}
          </h2>
          {selected.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selected.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePlayer(p)}
                  className="chip chip-active min-h-10 px-3"
                >
                  {i + 1}. {p.name} ×
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {playersStore.players
              .filter((p) => !p.isGuest)
              .map((p) => {
                const on = selected.some((s) => s.id === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlayer({ id: p.id, name: p.name, isGuest: false })}
                    className={cn(
                      "min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-semibold",
                      on
                        ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.2)]"
                        : "border-zinc-800 bg-zinc-900"
                    )}
                  >
                    {p.name}
                  </button>
                );
              })}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Guest name"
              className="input min-h-11 flex-1"
              onKeyDown={(e) => e.key === "Enter" && addGuest()}
            />
            <button type="button" onClick={addGuest} className="btn-ghost min-h-11 shrink-0">
              + Guest
            </button>
            <button
              type="button"
              className="btn-ghost min-h-11 shrink-0"
              onClick={() => {
                const name = prompt("Save player as");
                if (name) {
                  const p = playersStore.addPlayer(name, false);
                  togglePlayer({ id: p.id, name: p.name, isGuest: false });
                }
              }}
            >
              + Save
            </button>
          </div>
        </section>
      )}

      {setupError && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {setupError}
        </div>
      )}

      <button
        type="button"
        disabled={!canStart}
        onClick={onStart}
        className="btn-primary min-h-14 w-full text-lg disabled:opacity-40"
      >
        Start {isTeams ? "team match" : "match"}
      </button>
    </div>
  );
}
