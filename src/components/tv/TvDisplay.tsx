"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  getHandler,
  getRemaining,
  getTeamForPlayer,
  isTeamGame,
  segmentLabel,
  suggestCheckout,
  teamScoreRows,
  threeDartAverage,
} from "@/engine";
import { Dartboard } from "@/components/board/Dartboard";
import { CricketScoreboard } from "@/components/scoring/CricketMarks";
import { VisitHistory } from "@/components/scoring/VisitHistory";
import { formatAvg } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";
import { useTvMatchFeed } from "@/hooks/useTvMatchFeed";

/**
 * Cinematic full-screen TV layout:
 * scores stack on the left, oversized board on the right (slightly overlapping).
 */
export function TvDisplay() {
  const settings = useSettingsStore();
  const [hydrated, setHydrated] = useState(false);
  const [boardSize, setBoardSize] = useState(520);

  useEffect(() => {
    settings.hydrate();
    setHydrated(true);
  }, [settings]);

  const room = settings.roomName || "Board 1";
  const { state, connected, statusText, callout, lastSyncAt } = useTvMatchFeed(
    hydrated ? room : ""
  );

  useEffect(() => {
    const fit = () => {
      const h = window.innerHeight;
      const w = window.innerWidth;
      setBoardSize(Math.round(Math.min(h * 0.88, w * 0.58, 720)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Idle / waiting
  if (!state) {
    return (
      <div className="tv-display relative flex min-h-dvh items-center justify-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-1/4 top-0 h-full w-1/2 bg-[radial-gradient(ellipse_at_center,rgb(225_6_0/0.22),transparent_65%)]" />
          <div className="absolute bottom-0 right-0 h-2/3 w-2/3 bg-[radial-gradient(ellipse_at_bottom_right,rgb(225_6_0/0.12),transparent_60%)]" />
        </div>
        <div className="relative z-10 text-center">
          <Image
            src="/brand/logo.png"
            alt="No.3"
            width={140}
            height={140}
            className="mx-auto opacity-95 drop-shadow-[0_0_40px_rgb(225_6_0/0.35)]"
          />
          <h1 className="font-logo mt-6 text-6xl tracking-tight text-white md:text-8xl">
            No.<span className="text-[var(--brand-red)]">3</span>
          </h1>
          <p className="font-display mt-3 text-sm tracking-[0.35em] text-zinc-500">
            {room} · {connected ? "LINKED" : "STANDBY"}
          </p>
          <p className="mt-6 text-base text-zinc-400">{statusText}</p>
          <p className="mt-3 max-w-md px-6 text-sm text-zinc-600">
            Keep the tablet on the scoring screen — it re-publishes the match every few
            seconds so this TV can reconnect after updates.
          </p>
        </div>
      </div>
    );
  }

  const handler = getHandler(state.mode);
  const statusLine = handler.getStatusLine?.(state) ?? state.mode;
  const current = state.players[state.currentPlayerIndex];
  const currentTeam = current ? getTeamForPlayer(state, current.id) : null;
  const turnTotal = state.currentTurnDarts.reduce((a, d) => a + d.value, 0);
  const checkout = suggestCheckout(state);
  const teamMode = isTeamGame(state) && state.mode !== "killer";

  return (
    <div className="tv-display relative min-h-dvh overflow-hidden bg-[#050505]">
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_70%_45%,rgb(225_6_0/0.14),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_0%_50%,rgb(225_6_0/0.08),transparent_50%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#050505_0%,#050505_38%,transparent_72%)]" />
        {/* subtle scan / grain */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 3px)",
          }}
        />
      </div>

      {/* Top brand strip */}
      <header className="relative z-20 flex items-center justify-between px-6 py-4 lg:px-10">
        <div className="flex items-center gap-4">
          <Image
            src="/brand/logo.png"
            alt="No.3"
            width={48}
            height={48}
            className="rounded-full ring-1 ring-[rgb(225_6_0/0.4)]"
          />
          <div>
            <div className="font-logo text-xl leading-none text-white lg:text-2xl">
              No.<span className="text-[var(--brand-red)]">3</span>{" "}
              <span className="text-zinc-500">Darts</span>
            </div>
            <div className="font-display mt-1 text-[10px] tracking-[0.28em] text-zinc-600">
              {settings.barName.toUpperCase()}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-[10px] tracking-[0.3em] text-zinc-600">
            {room.toUpperCase()} · LEG {state.legNumber}
          </div>
          <div className="font-display text-xs tracking-widest text-zinc-500">
            {statusLine}
            {state.status === "paused" && (
              <span className="ml-3 text-[var(--style-orange)]">PAUSED</span>
            )}
          </div>
          <div className="mt-1 font-display text-[10px] tracking-wider text-zinc-700">
            <span className={connected ? "text-emerald-600" : "text-zinc-600"}>
              {connected ? "●" : "○"}
            </span>{" "}
            {statusText}
            {lastSyncAt
              ? ` · ${Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000))}s ago`
              : ""}
          </div>
        </div>
      </header>

      {/* Main stage: left scores · right board overlay */}
      <div className="relative z-10 flex min-h-[calc(100dvh-5.5rem)]">
        {/* LEFT — score column */}
        <aside className="relative z-20 flex w-[min(48vw,640px)] shrink-0 flex-col justify-between px-6 pb-8 pt-2 lg:w-[min(46vw,680px)] lg:px-10">
          <div className="flex flex-1 flex-col justify-center gap-3 lg:gap-4">
            {state.mode === "cricket" ? (
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-4 backdrop-blur-sm lg:px-5 lg:py-6">
                <div className="mb-3 font-display text-[10px] tracking-[0.35em] text-zinc-600">
                  CRICKET{teamMode ? " · DOUBLES" : ""}
                </div>
                <CricketScoreboard state={state} size="lg" />
              </div>
            ) : teamMode ? (
              teamScoreRows(state).map((row) => {
                const rem =
                  state.mode === "x01"
                    ? getRemaining(state, row.team.playerIds[0])
                    : row.score;
                const thrower = row.throwerId
                  ? state.players.find((p) => p.id === row.throwerId)
                  : null;
                return (
                  <div
                    key={row.team.id}
                    className={`relative overflow-hidden rounded-2xl border px-5 py-4 transition-all duration-300 lg:px-6 lg:py-5 ${
                      row.active
                        ? "border-[var(--brand-red)] bg-gradient-to-r from-[rgb(225_6_0/0.28)] via-[rgb(225_6_0/0.12)] to-transparent shadow-[0_0_48px_rgb(225_6_0/0.25)]"
                        : "border-white/5 bg-white/[0.03] backdrop-blur-sm"
                    }`}
                  >
                    {row.active && (
                      <div className="absolute left-0 top-0 h-full w-1 bg-[var(--brand-red)] shadow-[0_0_12px_var(--brand-red)]" />
                    )}
                    <div className="flex items-end justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate font-display text-xl font-bold tracking-wide text-white lg:text-2xl xl:text-3xl">
                          {row.team.name}
                        </div>
                        <div className="mt-1 truncate font-semibold text-base text-zinc-400 lg:text-lg">
                          {row.playerNames.join("  ·  ")}
                        </div>
                        {row.active && thrower && (
                          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--brand-red)] px-4 py-1.5 shadow-[0_0_20px_rgb(225_6_0/0.35)]">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                            <span className="font-display text-base font-bold tracking-wide text-white lg:text-lg">
                              {thrower.name} throws
                            </span>
                          </div>
                        )}
                      </div>
                      <div
                        className={`shrink-0 font-black tabular-nums leading-none tracking-tighter ${
                          row.active
                            ? "text-[clamp(3.5rem,9vw,7.5rem)] text-[var(--brand-red-bright)] drop-shadow-[0_0_30px_rgb(225_6_0/0.45)]"
                            : "text-[clamp(2.5rem,6vw,5rem)] text-white/90"
                        }`}
                      >
                        {state.mode === "x01" ? rem : row.score}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              state.players.map((p, idx) => {
                const ps = state.playerStates.find((s) => s.playerId === p.id)!;
                const active =
                  idx === state.currentPlayerIndex && state.status === "playing";
                const rem = getRemaining(state, p.id);
                const avg = threeDartAverage(ps);
                const display = state.mode === "killer" ? ps.score : rem;

                return (
                  <div
                    key={p.id}
                    className={`relative overflow-hidden rounded-2xl border px-5 py-4 transition-all duration-300 lg:px-6 lg:py-5 ${
                      active
                        ? "border-[var(--brand-red)] bg-gradient-to-r from-[rgb(225_6_0/0.28)] via-[rgb(225_6_0/0.12)] to-transparent shadow-[0_0_48px_rgb(225_6_0/0.25)]"
                        : "border-white/5 bg-white/[0.03] backdrop-blur-sm"
                    }`}
                  >
                    {active && (
                      <div className="absolute left-0 top-0 h-full w-1 bg-[var(--brand-red)] shadow-[0_0_12px_var(--brand-red)]" />
                    )}
                    <div className="flex items-end justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-display truncate text-sm tracking-[0.2em] lg:text-base ${
                              active ? "text-white" : "text-zinc-500"
                            }`}
                          >
                            {p.name.toUpperCase()}
                          </span>
                          {active && (
                            <span className="shrink-0 animate-pulse rounded-full bg-[var(--brand-red)] px-2 py-0.5 font-display text-[9px] tracking-wider text-white">
                              LIVE
                            </span>
                          )}
                        </div>
                        <div className="mt-1 font-display text-[11px] tracking-wider text-zinc-600">
                          AVG {formatAvg(avg)}
                          {ps.oneEighties > 0 && (
                            <span className="ml-2 text-[var(--style-orange)]">
                              {ps.oneEighties}×180
                            </span>
                          )}
                          {state.matchFormat.legsToWin > 1 && (
                            <span className="ml-2">· L{ps.legsWon}</span>
                          )}
                        </div>
                      </div>
                      <div
                        className={`shrink-0 font-black tabular-nums leading-none tracking-tighter ${
                          active
                            ? "text-[clamp(3.5rem,9vw,7.5rem)] text-[var(--brand-red-bright)] drop-shadow-[0_0_30px_rgb(225_6_0/0.45)]"
                            : "text-[clamp(2.5rem,6vw,5rem)] text-white/90"
                        }`}
                      >
                        {display}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Visit strip + history */}
          <div className="mt-6 border-t border-white/5 pt-5">
            <div className="font-display text-xs tracking-[0.25em] text-zinc-500">
              THIS VISIT
              {currentTeam && currentTeam.playerIds.length > 1
                ? ` · ${currentTeam.name}`
                : ""}
            </div>
            <div className="mt-1 font-display text-lg font-bold text-white lg:text-xl">
              {current?.name}
              <span className="ml-2 font-normal text-zinc-500">throws</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              {[0, 1, 2].map((i) => {
                const d = state.currentTurnDarts[i];
                return (
                  <div
                    key={i}
                    className={`flex h-16 w-20 items-center justify-center rounded-xl border font-logo text-xl lg:h-20 lg:w-24 lg:text-2xl ${
                      d
                        ? "border-[var(--brand-red)]/60 bg-[rgb(225_6_0/0.12)] text-[var(--brand-red-bright)] shadow-[0_0_20px_rgb(225_6_0/0.15)]"
                        : "border-dashed border-white/10 text-zinc-700"
                    }`}
                  >
                    {d ? segmentLabel(d.kind, d.number) : "—"}
                  </div>
                );
              })}
              <div className="ml-2">
                <div className="font-display text-xs tracking-widest text-zinc-600">TURN</div>
                <div className="font-logo text-4xl tabular-nums text-white lg:text-5xl">
                  {turnTotal}
                </div>
              </div>
            </div>
            {checkout && (
              <div className="mt-4 font-display text-base tracking-wider text-[var(--brand-red-bright)]/90 lg:text-lg">
                <span className="text-zinc-600">CHECKOUT </span>
                {checkout.description}
              </div>
            )}
            <div className="mt-5">
              <VisitHistory state={state} limit={8} size="lg" />
            </div>
          </div>
        </aside>

        {/* RIGHT — board, oversized, bleeds left slightly */}
        <div className="relative flex min-w-0 flex-1 items-center justify-end pr-2 lg:pr-6">
          {/* Soft vignette behind board */}
          <div className="pointer-events-none absolute right-[8%] top-1/2 h-[90%] w-[90%] -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(225_6_0/0.18)_0%,transparent_65%)] blur-2xl" />

          <div
            className="relative -ml-16 origin-right scale-100 lg:-ml-28"
            style={{
              filter: "drop-shadow(0 24px 80px rgba(0,0,0,0.65)) drop-shadow(0 0 60px rgba(225,6,0,0.12))",
            }}
          >
            <Dartboard
              marks={state.currentTurnDarts}
              size={boardSize}
              showLiveLabel={false}
              className="relative z-10"
            />
          </div>
        </div>
      </div>

      {/* Callout burst */}
      {callout && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <div className="relative animate-[modalPop_0.25s_ease-out] rounded-3xl border border-[var(--brand-red)] bg-black/85 px-16 py-8 shadow-[0_0_80px_rgb(225_6_0/0.4)]">
            <div className="font-logo text-6xl text-[var(--brand-red-bright)] lg:text-8xl">
              {callout}
            </div>
          </div>
        </div>
      )}

      {/* Match / leg win */}
      {(state.status === "leg_won" || state.status === "match_won") && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="text-center">
            <div className="font-display text-sm tracking-[0.4em] text-[var(--brand-red-bright)]">
              {state.status === "match_won" ? "MATCH" : "LEG"}
            </div>
            <div className="font-logo mt-2 text-7xl text-white drop-shadow-[0_0_40px_rgb(225_6_0/0.5)] lg:text-9xl">
              {state.players.find((p) => p.id === (state.winnerId ?? state.legWinnerId))?.name}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
