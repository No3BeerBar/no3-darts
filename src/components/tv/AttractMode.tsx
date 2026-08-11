"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { listModes } from "@/engine";
import {
  formatLeaderboardValue,
  LEADERBOARD_METRICS,
  type LeaderboardEntry,
  type LeaderboardMetric,
} from "@/lib/leaderboard";
import { cn } from "@/lib/utils";

type Boards = Record<LeaderboardMetric, LeaderboardEntry[]>;

type LeaderboardPayload = {
  ok: boolean;
  dbAvailable: boolean;
  weekly: { boards: Boards; since: number | null; until: number } | null;
  allTime: { boards: Boards; since: number | null; until: number } | null;
};

type PanelKind =
  | { type: "board"; window: "week" | "all"; metric: LeaderboardMetric }
  | { type: "games" }
  | { type: "cta" };

const PANEL_MS = 12_000;
const REFRESH_MS = 45_000;

const EMPTY_BOARDS: Boards = {
  avg: [],
  wins: [],
  oneEighties: [],
  highestCheckout: [],
};

function metricLabel(id: LeaderboardMetric): string {
  return LEADERBOARD_METRICS.find((m) => m.id === id)?.shortLabel ?? id.toUpperCase();
}

export function AttractMode({
  room,
  barName,
  connected,
}: {
  room: string;
  barName: string;
  connected: boolean;
}) {
  const modes = useMemo(() => listModes(), []);
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [panelIndex, setPanelIndex] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/leaderboard?limit=8&minMatches=1&_=${Date.now()}`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const json = (await r.json()) as LeaderboardPayload;
        if (!stopped) setData(json);
      } catch {
        if (!stopped) {
          setData({
            ok: true,
            dbAvailable: false,
            weekly: null,
            allTime: null,
          });
        }
      }
    };
    void load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const weeklyBoards = data?.weekly?.boards ?? EMPTY_BOARDS;
  const allBoards = data?.allTime?.boards ?? EMPTY_BOARDS;
  const dbOk = Boolean(data?.dbAvailable);

  const panels = useMemo<PanelKind[]>(() => {
    const list: PanelKind[] = [];
    // Prefer panels that have rows; always include games + CTA
    for (const m of LEADERBOARD_METRICS) {
      if (weeklyBoards[m.id]?.length) {
        list.push({ type: "board", window: "week", metric: m.id });
      }
    }
    for (const m of LEADERBOARD_METRICS) {
      if (allBoards[m.id]?.length) {
        list.push({ type: "board", window: "all", metric: m.id });
      }
    }
    // If no leaderboard data, still rotate a friendly empty board once
    if (list.length === 0) {
      list.push({ type: "board", window: "week", metric: "avg" });
      list.push({ type: "board", window: "all", metric: "wins" });
    }
    list.push({ type: "games" });
    list.push({ type: "cta" });
    return list;
  }, [weeklyBoards, allBoards]);

  useEffect(() => {
    setPanelIndex(0);
  }, [panels.length]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPanelIndex((i) => (i + 1) % Math.max(panels.length, 1));
      setTick((t) => t + 1);
    }, PANEL_MS);
    return () => window.clearInterval(id);
  }, [panels.length]);

  const panel = panels[panelIndex % panels.length] ?? { type: "games" as const };
  const rows =
    panel.type === "board"
      ? panel.window === "week"
        ? weeklyBoards[panel.metric]
        : allBoards[panel.metric]
      : [];

  return (
    <div className="tv-display relative flex min-h-dvh flex-col overflow-hidden bg-[#050505]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-10%,rgb(225_6_0/0.28),transparent_55%)]" />
        <div className="absolute bottom-0 left-0 h-1/2 w-1/2 bg-[radial-gradient(ellipse_at_bottom_left,rgb(225_6_0/0.12),transparent_60%)]" />
        <div className="absolute bottom-0 right-0 h-2/3 w-1/2 bg-[radial-gradient(ellipse_at_bottom_right,rgb(146_4_0/0.2),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 3px)",
          }}
        />
      </div>

      <header className="relative z-20 flex items-center justify-between px-8 pb-2 pt-6 lg:px-14 lg:pt-8">
        <div className="flex items-center gap-5">
          <Image
            src="/brand/logo.png"
            alt="No.3"
            width={72}
            height={72}
            className="tv-attract-logo rounded-full ring-1 ring-[rgb(225_6_0/0.45)]"
            priority
          />
          <div>
            <div className="font-logo text-4xl leading-none text-white lg:text-5xl xl:text-6xl">
              No.<span className="text-[var(--brand-red)]">3</span>
            </div>
            <div className="font-display mt-2 text-xs tracking-[0.35em] text-zinc-500 lg:text-sm">
              {(barName || "Craft Beer Bar").toUpperCase()}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-xs tracking-[0.35em] text-zinc-600 lg:text-sm">
            {room.toUpperCase()}
          </div>
          <div className="mt-1 font-display text-sm tracking-[0.2em] text-zinc-500">
            <span className={connected ? "text-emerald-500" : "text-zinc-600"}>
              {connected ? "●" : "○"}
            </span>{" "}
            IDLE · ATTRACT
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-stretch px-8 pb-8 pt-4 lg:px-14 lg:pb-10">
        <div
          key={`${panelIndex}-${tick}`}
          className="tv-attract-panel flex w-full flex-col justify-center"
        >
          {panel.type === "board" && (
            <LeaderboardPanel
              title={panel.window === "week" ? "This week" : "All-time"}
              subtitle={metricLabel(panel.metric)}
              metric={panel.metric}
              rows={rows}
              emptyHint={
                dbOk
                  ? "Play a match with a PIN account to climb the board."
                  : "Stats offline — games still open on the tablet."
              }
            />
          )}
          {panel.type === "games" && <GamesPanel modes={modes} />}
          {panel.type === "cta" && <CtaPanel room={room} />}
        </div>
      </main>

      <footer className="relative z-20 flex items-center justify-between px-8 pb-6 lg:px-14">
        <div className="flex gap-2">
          {panels.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-500",
                i === panelIndex % panels.length
                  ? "w-8 bg-[var(--brand-red)]"
                  : "w-2 bg-zinc-700"
              )}
            />
          ))}
        </div>
        <div className="font-display text-[10px] tracking-[0.3em] text-zinc-700 lg:text-xs">
          START ON TABLET · /PLAY
        </div>
      </footer>
    </div>
  );
}

function LeaderboardPanel({
  title,
  subtitle,
  metric,
  rows,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  metric: LeaderboardMetric;
  rows: LeaderboardEntry[];
  emptyHint: string;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-6 flex items-end justify-between gap-6 lg:mb-10">
        <div>
          <div className="font-display text-sm tracking-[0.4em] text-[var(--brand-red-bright)] lg:text-base">
            {title.toUpperCase()}
          </div>
          <h2 className="font-logo mt-2 text-5xl text-white lg:text-7xl xl:text-8xl">
            {subtitle}
          </h2>
        </div>
        <div className="hidden font-display text-xs tracking-[0.25em] text-zinc-600 md:block lg:text-sm">
          REGISTERED PLAYERS
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-16 text-center">
          <p className="font-display text-xl tracking-wide text-zinc-500 lg:text-2xl">
            {emptyHint}
          </p>
        </div>
      ) : (
        <ol className="tv-attract-scroll space-y-3 lg:space-y-4">
          {rows.map((r, i) => (
            <li
              key={r.playerId}
              className="tv-attract-row flex items-center gap-5 rounded-2xl border border-white/5 bg-white/[0.03] px-5 py-4 lg:gap-8 lg:px-8 lg:py-5"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-logo text-xl lg:h-16 lg:w-16 lg:text-3xl",
                  i === 0
                    ? "bg-[var(--brand-red)] text-white shadow-[0_0_24px_rgb(225_6_0/0.35)]"
                    : i === 1
                      ? "bg-zinc-300 text-zinc-900"
                      : i === 2
                        ? "bg-[var(--brand-red-dim)] text-red-100"
                        : "bg-zinc-800 text-zinc-400"
                )}
              >
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-2xl font-bold tracking-wide text-white lg:text-4xl">
                  {r.name}
                </div>
                <div className="mt-1 font-display text-xs tracking-wider text-zinc-600 lg:text-sm">
                  {r.matchesPlayed} match{r.matchesPlayed === 1 ? "" : "es"}
                  {r.matchesWon > 0 ? ` · ${r.matchesWon} win${r.matchesWon === 1 ? "" : "s"}` : ""}
                </div>
              </div>
              <div className="shrink-0 font-logo text-4xl tabular-nums text-[var(--brand-red-bright)] lg:text-6xl">
                {formatLeaderboardValue(r, metric)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GamesPanel({
  modes,
}: {
  modes: Array<{ id: string; name: string; description: string }>;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-6 lg:mb-10">
        <div className="font-display text-sm tracking-[0.4em] text-[var(--brand-red-bright)] lg:text-base">
          ON THE TABLET
        </div>
        <h2 className="font-logo mt-2 text-5xl text-white lg:text-7xl xl:text-8xl">
          Games
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-5">
        {modes.map((m, i) => (
          <div
            key={m.id}
            className="tv-attract-row rounded-2xl border border-white/8 bg-gradient-to-b from-white/[0.06] to-transparent px-4 py-5 lg:px-5 lg:py-7"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="font-logo text-2xl text-white lg:text-3xl xl:text-4xl">
              {m.name}
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-zinc-500 lg:text-base">
              {m.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CtaPanel({ room }: { room: string }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center text-center">
      <div className="font-display text-sm tracking-[0.4em] text-[var(--brand-red-bright)] lg:text-base">
        {room.toUpperCase()}
      </div>
      <h2 className="font-logo mt-4 text-5xl leading-none text-white lg:text-7xl xl:text-8xl">
        Grab the iPad
      </h2>
      <p className="mt-6 max-w-2xl text-xl text-zinc-400 lg:text-2xl">
        Open <span className="text-white">/play</span>, pick a mode, sign in with your name + PIN —
        this screen flips to live scoring when the match starts.
      </p>
      <div className="tv-attract-pulse mt-12 inline-flex items-center gap-3 rounded-2xl border border-[var(--brand-red)]/50 bg-[rgb(225_6_0/0.15)] px-8 py-4 font-display text-lg tracking-[0.2em] text-white lg:text-xl">
        <span className="h-3 w-3 rounded-full bg-[var(--brand-red)]" />
        WAITING FOR MATCH
      </div>
    </div>
  );
}
