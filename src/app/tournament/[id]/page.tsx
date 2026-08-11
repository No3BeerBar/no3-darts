"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { GameModeId } from "@/engine";
import type {
  LaneOverview,
  LegModePolicy,
  Tournament,
  TournamentLane,
} from "@/lib/tournament";
import { GAME_MODE_IDS, bestOfLabel, defaultModeConfig } from "@/lib/tournament";
import { tournamentStaffFetch } from "@/lib/tournament/staff-fetch";
import { BracketView } from "@/components/tournament/BracketView";
import { LaneOverviewPanel } from "@/components/tournament/LaneOverview";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";

const MODE_LABELS: Record<string, string> = {
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

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const settings = useSettingsStore();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [lanes, setLanes] = useState<LaneOverview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [serverPlayers, setServerPlayers] = useState<
    Array<{ id: string; name: string }>
  >([]);

  // Draft editors
  const [name, setName] = useState("");
  const [legsToWin, setLegsToWin] = useState(2);
  const [policy, setPolicy] = useState<LegModePolicy>("fixed");
  const [allowed, setAllowed] = useState<GameModeId[]>(["x01"]);
  const [fixedMode, setFixedMode] = useState<GameModeId>("x01");
  const [presetModes, setPresetModes] = useState<GameModeId[]>(["x01", "x01", "cricket"]);

  const refresh = useCallback(async () => {
    const [tRes, lRes] = await Promise.all([
      fetch(`/api/tournaments/${id}`),
      fetch("/api/tournaments/lanes"),
    ]);
    const tData = (await tRes.json()) as { ok?: boolean; tournament?: Tournament; error?: string };
    if (!tRes.ok || !tData.tournament) {
      setError(tData.error ?? "Not found");
      setTournament(null);
      return;
    }
    setTournament(tData.tournament);
    setName(tData.tournament.name);
    setLegsToWin(tData.tournament.format.legsToWin);
    setPolicy(tData.tournament.format.legModePolicy);
    setAllowed(tData.tournament.format.allowedModes);
    if (tData.tournament.format.fixedModeConfig) {
      setFixedMode(tData.tournament.format.fixedModeConfig.mode);
    }
    if (tData.tournament.format.presetSequence?.length) {
      setPresetModes(tData.tournament.format.presetSequence.map((m) => m.mode));
    }
    setError(null);

    const lData = (await lRes.json()) as { lanes?: LaneOverview[] };
    setLanes(lData.lanes ?? []);
  }, [id]);

  useEffect(() => {
    settings.hydrate();
  }, [settings]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    void fetch("/api/players")
      .then((r) => r.json())
      .then((data: { players?: Array<{ id: string; name: string }> }) => {
        setServerPlayers(data.players ?? []);
      })
      .catch(() => setServerPlayers([]));
  }, []);

  const draftPlayers = tournament?.players ?? [];

  const formatPayload = useMemo(() => {
    const base = {
      legsToWin,
      legModePolicy: policy,
      allowedModes: allowed.length ? allowed : (["x01"] as GameModeId[]),
      fixedModeConfig:
        policy === "fixed" ? defaultModeConfig(fixedMode) : null,
      presetSequence:
        policy === "preset_sequence"
          ? presetModes.map((m) => defaultModeConfig(m))
          : null,
    };
    return base;
  }, [legsToWin, policy, allowed, fixedMode, presetModes]);

  const saveDraft = async (players = draftPlayers) => {
    setBusy(true);
    setError(null);
    try {
      const res = await tournamentStaffFetch(`/api/tournaments/${id}`, {
        method: "PATCH",
        staffPin: settings.staffPin,
        body: JSON.stringify({
          name,
          format: formatPayload,
          players: players.map((p) => ({
            displayName: p.displayName,
            isGuest: p.isGuest,
            registeredPlayerId: p.registeredPlayerId,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; tournament?: Tournament; error?: string };
      if (!res.ok || !data.tournament) throw new Error(data.error ?? "Save failed");
      setTournament(data.tournament);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const addGuest = async () => {
    const displayName = guestName.trim();
    if (!displayName || !tournament) return;
    const next = [
      ...draftPlayers,
      {
        id: "tmp",
        tournamentId: id,
        displayName,
        isGuest: true,
        registeredPlayerId: null,
        seed: draftPlayers.length + 1,
      },
    ];
    setGuestName("");
    await saveDraft(next);
  };

  const addRegistered = async (p: { id: string; name: string }) => {
    if (!tournament) return;
    if (draftPlayers.some((x) => x.registeredPlayerId === p.id)) return;
    const next = [
      ...draftPlayers,
      {
        id: "tmp",
        tournamentId: id,
        displayName: p.name,
        isGuest: false,
        registeredPlayerId: p.id,
        seed: draftPlayers.length + 1,
      },
    ];
    await saveDraft(next);
  };

  const removePlayer = async (playerId: string) => {
    await saveDraft(draftPlayers.filter((p) => p.id !== playerId));
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveDraft();
      const res = await tournamentStaffFetch(`/api/tournaments/${id}/start`, {
        method: "POST",
        staffPin: settings.staffPin,
      });
      const data = (await res.json()) as { ok?: boolean; tournament?: Tournament; error?: string };
      if (!res.ok || !data.tournament) throw new Error(data.error ?? "Start failed");
      setTournament(data.tournament);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Start failed");
    } finally {
      setBusy(false);
    }
  };

  const onAssign = async (matchId: string, lane: TournamentLane | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await tournamentStaffFetch(
        `/api/tournaments/${id}/matches/${matchId}/assign`,
        {
          method: "POST",
          staffPin: settings.staffPin,
          body: JSON.stringify({ lane }),
        }
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Assign failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleAllowed = (mode: GameModeId) => {
    setAllowed((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
  };

  if (!tournament && !error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-zinc-500">Loading tournament…</div>
    );
  }

  if (!tournament) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <p className="text-amber-300">{error}</p>
        <Link href="/tournament" className="text-[var(--brand-red-bright)] underline">
          Back
        </Link>
      </div>
    );
  }

  const isDraft = tournament.status === "draft";

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/tournament" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← Tournaments
          </Link>
          <h1 className="font-logo text-3xl text-white">{tournament.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {tournament.status} · {bestOfLabel(tournament.format.legsToWin)} ·{" "}
            {tournament.format.legModePolicy.replace(/_/g, " ")}
          </p>
        </div>
        <span
          className={cn(
            "rounded-lg px-3 py-1 font-display text-xs tracking-wider",
            tournament.status === "active"
              ? "bg-emerald-950 text-emerald-400"
              : tournament.status === "completed"
                ? "bg-zinc-900 text-zinc-400"
                : "bg-amber-950 text-amber-300"
          )}
        >
          {tournament.status}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
          {error}
        </div>
      )}

      {!isDraft && (
        <section className="space-y-3">
          <h2 className="section-title">Lanes</h2>
          <LaneOverviewPanel lanes={lanes} />
        </section>
      )}

      {isDraft ? (
        <>
          <section className="panel-card space-y-4 p-6">
            <h2 className="section-title">Setup</h2>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-[var(--panel-border)] bg-black px-3 py-3 text-white outline-none focus:border-[var(--brand-red)]"
              />
            </label>

            <div>
              <div className="mb-2 text-xs text-zinc-500">Legs (first to)</div>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setLegsToWin(n)}
                    className={cn(
                      "min-h-10 min-w-10 rounded-lg font-display text-sm",
                      legsToWin === n
                        ? "bg-[var(--brand-red)] text-white"
                        : "bg-black text-zinc-400 ring-1 ring-[var(--panel-border)]"
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-zinc-600">{bestOfLabel(legsToWin)}</p>
            </div>

            <div>
              <div className="mb-2 text-xs text-zinc-500">Game policy</div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["fixed", "Same game every leg"],
                    ["choose_each_leg", "Choose each leg"],
                    ["preset_sequence", "Preset sequence"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPolicy(id)}
                    className={cn(
                      "min-h-10 rounded-lg px-3 font-display text-xs tracking-wider",
                      policy === id
                        ? "bg-[var(--brand-red)] text-white"
                        : "bg-black text-zinc-400 ring-1 ring-[var(--panel-border)]"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs text-zinc-500">Allowed modes</div>
              <div className="flex flex-wrap gap-2">
                {GAME_MODE_IDS.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => toggleAllowed(mode)}
                    className={cn(
                      "min-h-9 rounded-lg px-3 font-display text-xs",
                      allowed.includes(mode)
                        ? "bg-[var(--brand-red)] text-white"
                        : "bg-black text-zinc-500 ring-1 ring-[var(--panel-border)]"
                    )}
                  >
                    {MODE_LABELS[mode] ?? mode}
                  </button>
                ))}
              </div>
            </div>

            {policy === "fixed" && (
              <div>
                <div className="mb-2 text-xs text-zinc-500">Fixed game</div>
                <div className="flex flex-wrap gap-2">
                  {allowed.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFixedMode(mode)}
                      className={cn(
                        "min-h-9 rounded-lg px-3 font-display text-xs",
                        fixedMode === mode
                          ? "bg-[var(--brand-red)] text-white"
                          : "bg-black text-zinc-400 ring-1 ring-[var(--panel-border)]"
                      )}
                    >
                      {MODE_LABELS[mode] ?? mode}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {policy === "preset_sequence" && (
              <div className="space-y-2">
                <div className="text-xs text-zinc-500">
                  Preset per leg (length should cover first-to-{legsToWin})
                </div>
                {presetModes.map((mode, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-12 text-xs text-zinc-600">Leg {i + 1}</span>
                    <select
                      value={mode}
                      onChange={(e) => {
                        const v = e.target.value as GameModeId;
                        setPresetModes((prev) => prev.map((m, j) => (j === i ? v : m)));
                      }}
                      className="rounded-lg border border-[var(--panel-border)] bg-black px-2 py-2 text-sm text-white"
                    >
                      {allowed.map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABELS[m] ?? m}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setPresetModes((prev) => [...prev, allowed[0] ?? "x01"])
                  }
                  className="btn-ghost min-h-9 px-3 text-xs"
                >
                  Add leg slot
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void saveDraft()}
              className="btn-ghost min-h-11 px-5"
            >
              Save setup
            </button>
          </section>

          <section className="panel-card space-y-4 p-6">
            <h2 className="section-title">Players ({draftPlayers.length})</h2>
            <p className="text-sm text-zinc-500">
              Guests play in the event only — no persistent history outside the tournament.
              PIN players keep their accounts for casual play.
            </p>
            <ul className="space-y-1">
              {draftPlayers.map((p, i) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-lg bg-black px-3 py-2"
                >
                  <span className="text-sm text-white">
                    <span className="text-zinc-600">#{i + 1}</span> {p.displayName}
                    {p.isGuest ? (
                      <span className="ml-2 text-xs text-zinc-600">guest</span>
                    ) : (
                      <span className="ml-2 text-xs text-emerald-700">PIN</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removePlayer(p.id)}
                    className="text-xs text-zinc-500 hover:text-white"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex gap-2">
              <input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Guest name"
                className="min-w-0 flex-1 rounded-lg border border-[var(--panel-border)] bg-black px-3 py-3 text-white outline-none focus:border-[var(--brand-red)]"
              />
              <button
                type="button"
                disabled={busy || !guestName.trim()}
                onClick={() => void addGuest()}
                className="btn-primary min-h-11 px-4"
              >
                Add guest
              </button>
            </div>

            {serverPlayers.length > 0 && (
              <div>
                <div className="mb-2 text-xs text-zinc-500">Registered players</div>
                <div className="flex flex-wrap gap-2">
                  {serverPlayers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={draftPlayers.some((x) => x.registeredPlayerId === p.id)}
                      onClick={() => void addRegistered(p)}
                      className="btn-ghost min-h-9 px-3 text-xs disabled:opacity-40"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={busy || draftPlayers.length < 2}
              onClick={() => void start()}
              className="btn-primary min-h-12 w-full"
            >
              Start tournament (build bracket)
            </button>
          </section>
        </>
      ) : (
        <section className="space-y-3">
          <h2 className="section-title">Bracket</h2>
          <p className="text-sm text-zinc-500">
            Assign ready matches to Board 1–3. Lane tablets on{" "}
            <Link href="/" className="text-[var(--brand-red-bright)] underline">
              Play
            </Link>{" "}
            will show “Tournament match ready”.
          </p>
          <BracketView
            tournament={tournament}
            onAssign={tournament.status === "active" ? onAssign : undefined}
            busy={busy}
          />
        </section>
      )}
    </div>
  );
}
