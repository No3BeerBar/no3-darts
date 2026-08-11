"use client";

import { useEffect, useMemo, useState } from "react";
import { listModes, type GameModeId } from "@/engine";
import {
  formatLeaderboardValue,
  LEADERBOARD_METRICS,
  type LeaderboardEntry,
  type LeaderboardMetric,
} from "@/lib/leaderboard";
import { leaderboard, type StoredPlayer } from "@/lib/storage";
import { cn, formatAvg } from "@/lib/utils";

type ModeFilter = "all" | GameModeId;
type WindowFilter = "week" | "all";

type ModeCatalogEntry = {
  mode: GameModeId;
  label: string;
  metrics: LeaderboardMetric[];
};

type ApiPayload = {
  ok: boolean;
  dbAvailable: boolean;
  modeCatalog?: ModeCatalogEntry[];
  weekly: {
    boards: Record<LeaderboardMetric, LeaderboardEntry[]>;
    byMode?: Partial<Record<GameModeId, Record<LeaderboardMetric, LeaderboardEntry[]>>>;
  } | null;
  allTime: {
    boards: Record<LeaderboardMetric, LeaderboardEntry[]>;
    byMode?: Partial<Record<GameModeId, Record<LeaderboardMetric, LeaderboardEntry[]>>>;
  } | null;
};

function localMetricValue(p: StoredPlayer, metric: LeaderboardMetric): string {
  const avg =
    p.stats.dartsThrown > 0
      ? (p.stats.totalScore / p.stats.dartsThrown) * 3
      : p.stats.bestThreeDartAvg;
  if (metric === "avg") return formatAvg(avg);
  if (metric === "wins") return String(p.stats.matchesWon);
  if (metric === "oneEighties") return String(p.stats.oneEighties);
  if (metric === "highestCheckout") return String(p.stats.highestCheckout);
  return "—";
}

export default function LeaderboardPage() {
  const engineModes = useMemo(() => listModes(), []);
  const [mode, setMode] = useState<ModeFilter>("all");
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("week");
  const [metric, setMetric] = useState<LeaderboardMetric>("wins");
  const [data, setData] = useState<ApiPayload | null>(null);
  const [localRows, setLocalRows] = useState<StoredPlayer[]>([]);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/leaderboard?limit=25&minMatches=1&mode=${mode}`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error("bad status");
        const json = (await r.json()) as ApiPayload;
        if (!stopped) setData(json);
      } catch {
        if (!stopped) setData({ ok: true, dbAvailable: false, weekly: null, allTime: null });
      }
    };
    void load();
    return () => {
      stopped = true;
    };
  }, [mode]);

  useEffect(() => {
    // Local fallback (mode-blind aggregates)
    const localMetric =
      metric === "avg" ||
      metric === "wins" ||
      metric === "oneEighties" ||
      metric === "highestCheckout"
        ? metric === "oneEighties"
          ? "oneEighties"
          : metric === "highestCheckout"
            ? "highestCheckout"
            : metric
        : "wins";
    setLocalRows(leaderboard(localMetric === "avg" ? "avg" : localMetric));
  }, [metric]);

  const catalog = data?.modeCatalog ?? engineModes.map((m) => ({
    mode: m.id,
    label: m.name,
    metrics: ["wins", "highScore"] as LeaderboardMetric[],
  }));

  const availableMetrics = useMemo((): LeaderboardMetric[] => {
    if (mode === "all") {
      return LEADERBOARD_METRICS.map((m) => m.id);
    }
    const spec = catalog.find((c) => c.mode === mode);
    return spec?.metrics ?? (["wins"] satisfies LeaderboardMetric[]);
  }, [mode, catalog]);

  useEffect(() => {
    if (!availableMetrics.includes(metric)) {
      setMetric(availableMetrics[0] ?? "wins");
    }
  }, [availableMetrics, metric]);

  const serverRows: LeaderboardEntry[] = useMemo(() => {
    const slice = windowFilter === "week" ? data?.weekly : data?.allTime;
    if (!slice) return [];
    if (mode === "all") return slice.boards?.[metric] ?? [];
    return slice.byMode?.[mode]?.[metric] ?? slice.boards?.[metric] ?? [];
  }, [data, windowFilter, mode, metric]);

  const useServer = Boolean(data?.dbAvailable);
  const title =
    LEADERBOARD_METRICS.find((m) => m.id === metric)?.label ?? metric;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-black text-zinc-50">Leaderboard</h1>
        <p className="mt-1 text-zinc-500">
          {useServer ? "Bar standings (Postgres)" : "Local standings"} · {title}
          {mode !== "all" ? ` · ${catalog.find((c) => c.mode === mode)?.label ?? mode}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("all")}
          className={mode === "all" ? "chip chip-active" : "chip"}
        >
          All modes
        </button>
        {catalog.map((c) => (
          <button
            key={c.mode}
            type="button"
            onClick={() => setMode(c.mode)}
            className={mode === c.mode ? "chip chip-active" : "chip"}
          >
            {c.label}
          </button>
        ))}
      </div>

      {useServer && (
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["week", "This week"],
              ["all", "All-time"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setWindowFilter(id)}
              className={windowFilter === id ? "chip chip-active" : "chip"}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {LEADERBOARD_METRICS.filter((m) => availableMetrics.includes(m.id)).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMetric(m.id)}
            className={metric === m.id ? "chip chip-active" : "chip"}
          >
            {m.shortLabel}
          </button>
        ))}
      </div>

      <ol className="space-y-2">
        {useServer ? (
          <>
            {serverRows.length === 0 && (
              <li className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
                No {title.toLowerCase()} yet
                {mode !== "all" ? ` for this mode` : ""}. Play with a PIN account to climb the board.
              </li>
            )}
            {serverRows.map((r, i) => (
              <li
                key={r.playerId}
                className="flex items-center gap-4 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-5 py-4"
              >
                <RankBadge i={i} />
                <div className="flex-1">
                  <div className="font-bold text-zinc-50">{r.name}</div>
                  <div className="text-xs text-zinc-500">
                    {r.matchesPlayed} matches
                    {r.matchesWon > 0 ? ` · ${r.matchesWon} wins` : ""}
                  </div>
                </div>
                <div className="font-logo text-2xl tabular-nums text-[var(--brand-red-bright)]">
                  {formatLeaderboardValue(r, metric)}
                </div>
              </li>
            ))}
          </>
        ) : (
          <>
            {localRows.length === 0 && (
              <li className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
                Play some matches to fill the board.
              </li>
            )}
            {localRows.map((p, i) => (
              <li
                key={p.id}
                className="flex items-center gap-4 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-5 py-4"
              >
                <RankBadge i={i} />
                <div className="flex-1">
                  <div className="font-bold text-zinc-50">{p.name}</div>
                  <div className="text-xs text-zinc-500">
                    {p.stats.matchesPlayed} matches · best avg {formatAvg(p.stats.bestThreeDartAvg)}
                  </div>
                </div>
                <div className="font-logo text-2xl tabular-nums text-[var(--brand-red-bright)]">
                  {localMetricValue(p, metric)}
                </div>
              </li>
            ))}
          </>
        )}
      </ol>
    </div>
  );
}

function RankBadge({ i }: { i: number }) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black",
        i === 0
          ? "bg-[var(--brand-red)] text-white"
          : i === 1
            ? "bg-[var(--panel-elevated)] text-white ring-1 ring-[var(--panel-border)]"
            : i === 2
              ? "bg-[var(--brand-red-dim)] text-red-100"
              : "bg-black text-zinc-400 ring-1 ring-[var(--panel-border)]"
      )}
    >
      {i + 1}
    </div>
  );
}
