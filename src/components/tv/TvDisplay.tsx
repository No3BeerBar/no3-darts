"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  baseballDartPoints,
  baseballInning,
  computePlayerRoundStats,
  fortyOneBoardFocus,
  fortyOneDartPoints,
  fortyOneExact41DartContributes,
  fortyOneTarget,
  formatRoundStat,
  getHandler,
  getKillerExtra,
  getRemaining,
  getTeamForPlayer,
  isTeamGame,
  killerBoardFocus,
  roundStatsForMode,
  segmentLabel,
  suggestCheckout,
  teamScoreRows,
  threeDartAverage,
} from "@/engine";
import { Dartboard } from "@/components/board/Dartboard";
import { BaseballBanner } from "@/components/scoring/BaseballBanner";
import { FortyOneBanner } from "@/components/scoring/FortyOneBanner";
import { CricketScoreboard } from "@/components/scoring/CricketMarks";
import { KillerBanner } from "@/components/scoring/KillerBanner";
import { VisitHistory } from "@/components/scoring/VisitHistory";
import { formatAvg } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";
import { AttractMode } from "@/components/tv/AttractMode";
import { useTvMatchFeed } from "@/hooks/useTvMatchFeed";

/**
 * Cinematic full-screen TV layout:
 * idle → attract loop; active match → scores + board.
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
  const { state, idle, connected, statusText, cameraNotice, lastSyncAt } =
    useTvMatchFeed(hydrated ? room : "");

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

  // Idle / attract (leaderboards + games) when no live match
  if (!hydrated || idle || !state) {
    return (
      <AttractMode
        room={room}
        barName={settings.barName || "No. 3 Craft Beer Bar"}
        connected={connected}
      />
    );
  }

  const handler = getHandler(state.mode);
  const statusLine = handler.getStatusLine?.(state) ?? state.mode;
  const current = state.players[state.currentPlayerIndex];
  const currentTeam = current ? getTeamForPlayer(state, current.id) : null;
  const baseball = state.mode === "baseball";
  const killer = state.mode === "killer";
  const fortyOne = state.mode === "forty_one";
  const inn = baseball ? baseballInning(state) : 0;
  const killerFocus = killer ? killerBoardFocus(state) : null;
  const f41Target = fortyOne ? fortyOneTarget(state) : null;
  const f41Focus = f41Target ? fortyOneBoardFocus(f41Target) : null;
  const turnTotal = state.currentTurnDarts.reduce((a, d) => {
    if (baseball) return a + baseballDartPoints(d, inn);
    if (fortyOne && f41Target) {
      return a + (f41Target.type === "exact_41" ? d.value : fortyOneDartPoints(d, f41Target));
    }
    return a + d.value;
  }, 0);
  const exact41Voided =
    Boolean(f41Target?.type === "exact_41") &&
    state.currentTurnDarts.some((d) => !fortyOneExact41DartContributes(d));
  const checkout = suggestCheckout(state);
  const teamMode = isTeamGame(state) && state.mode !== "killer";
  const boardFocusNumber = baseball
    ? inn
    : (killerFocus?.primary ?? f41Focus?.focusNumber ?? null);

  return (
    <div className="tv-display shell-black relative overflow-hidden">
      {cameraNotice && (
        <div className="pointer-events-none absolute inset-x-0 top-6 z-50 flex justify-center px-4">
          <div
            className={
              /takeout|pull darts/i.test(cameraNotice)
                ? "rounded-xl border border-sky-500/50 bg-sky-950/95 px-6 py-3 font-display text-lg tracking-wide text-sky-50 shadow-2xl backdrop-blur"
                : "rounded-xl border border-amber-500/50 bg-amber-950/95 px-6 py-3 font-display text-lg tracking-wide text-amber-100 shadow-2xl backdrop-blur"
            }
          >
            {cameraNotice}
          </div>
        </div>
      )}

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
          {baseball && (
            <div className="mb-3">
              <BaseballBanner state={state} size="lg" />
            </div>
          )}
          {killer && (
            <div className="mb-3">
              <KillerBanner state={state} size="lg" />
            </div>
          )}
          {fortyOne && (
            <div className="mb-3">
              <FortyOneBanner state={state} size="lg" />
            </div>
          )}
          <div className="flex flex-1 flex-col justify-center gap-3 lg:gap-4">
            {state.mode === "cricket" ? (
              <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-3 py-4 lg:px-5 lg:py-6">
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
                        ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.18)] shadow-[0_0_48px_rgb(225_6_0/0.25)]"
                        : "border-[var(--panel-border)] bg-[var(--panel)]"
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
                        {(() => {
                          const show = roundStatsForMode(state.mode);
                          if (!show.mpr && !show.ppr) return null;
                          const multi = state.matchFormat.legsToWin > 1;
                          return (
                            <div className="mt-2 space-y-0.5 font-display text-[11px] tracking-wider text-zinc-600">
                              {row.team.playerIds.map((pid, i) => {
                                const rs = computePlayerRoundStats(state, pid);
                                const bits: string[] = [];
                                if (show.mpr) {
                                  const m = formatRoundStat(rs.mpr, multi);
                                  if (m) bits.push(`MPR ${m}`);
                                }
                                if (show.ppr) {
                                  const pr = formatRoundStat(rs.ppr, multi);
                                  if (pr) bits.push(`PPR ${pr}`);
                                }
                                if (bits.length === 0) return null;
                                const label =
                                  row.team.playerIds.length > 1
                                    ? `${row.playerNames[i] ?? ""} · `
                                    : "";
                                return (
                                  <div key={pid}>
                                    {label}
                                    {bits.join(" · ")}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
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
                const k = killer ? getKillerExtra(ps) : null;
                const display = killer ? (k?.lives ?? ps.score) : rem;
                const out = Boolean(k?.eliminated);

                return (
                  <div
                    key={p.id}
                    className={`relative overflow-hidden rounded-2xl border px-5 py-4 transition-all duration-300 lg:px-6 lg:py-5 ${
                      out
                        ? "opacity-45 border-[var(--panel-border)] bg-black"
                        : active
                          ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.18)] shadow-[0_0_48px_rgb(225_6_0/0.25)]"
                          : k?.isKiller
                            ? "border-red-900/60 bg-[var(--panel)]"
                            : "border-[var(--panel-border)] bg-[var(--panel)]"
                    }`}
                  >
                    {active && !out && (
                      <div className="absolute left-0 top-0 h-full w-1 bg-[var(--brand-red)] shadow-[0_0_12px_var(--brand-red)]" />
                    )}
                    <div className="flex items-end justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-display truncate text-sm tracking-[0.2em] lg:text-base ${
                              active && !out ? "text-white" : "text-zinc-500"
                            }`}
                          >
                            {p.name.toUpperCase()}
                          </span>
                          {active && !out && (
                            <span className="shrink-0 animate-pulse rounded-full bg-[var(--brand-red)] px-2 py-0.5 font-display text-[9px] tracking-wider text-white">
                              LIVE
                            </span>
                          )}
                          {k?.isKiller && !out && (
                            <span className="shrink-0 rounded bg-red-700 px-2 py-0.5 font-display text-[10px] font-bold tracking-wider text-white">
                              K
                            </span>
                          )}
                          {out && (
                            <span className="shrink-0 font-display text-[10px] tracking-wider text-zinc-600">
                              OUT
                            </span>
                          )}
                        </div>
                        {killer && k ? (
                          <div className="mt-1 font-display text-[11px] tracking-wider text-zinc-500">
                            D{k.killerNumber}
                            {!k.isKiller && !out && " · NEED DOUBLE TO ARM"}
                            {k.isKiller && !out && " · ARMED"}
                          </div>
                        ) : (
                          <div className="mt-1 font-display text-[11px] tracking-wider text-zinc-600">
                            {(() => {
                              const show = roundStatsForMode(state.mode);
                              const rs = computePlayerRoundStats(state, p.id);
                              const multi = state.matchFormat.legsToWin > 1;
                              const bits: string[] = [];
                              if (show.mpr) {
                                const m = formatRoundStat(rs.mpr, multi);
                                if (m) bits.push(`MPR ${m}`);
                              }
                              if (show.ppr) {
                                const pr = formatRoundStat(rs.ppr, multi);
                                if (pr) bits.push(`PPR ${pr}`);
                              }
                              if (bits.length === 0 && !show.mpr && !show.ppr) {
                                bits.push(`AVG ${formatAvg(avg)}`);
                              }
                              return bits.join(" · ");
                            })()}
                            {ps.oneEighties > 0 && (
                              <span className="ml-2 text-[var(--style-orange)]">
                                {ps.oneEighties}×180
                              </span>
                            )}
                            {state.matchFormat.legsToWin > 1 && (
                              <span className="ml-2">· L{ps.legsWon}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div
                        className={`shrink-0 font-black tabular-nums leading-none tracking-tighter ${
                          out
                            ? "text-[clamp(2.5rem,6vw,5rem)] text-zinc-600 line-through"
                            : active
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
                const pts =
                  d && baseball
                    ? baseballDartPoints(d, inn)
                    : d && fortyOne && f41Target
                      ? fortyOneDartPoints(d, f41Target)
                      : d?.value;
                return (
                  <div
                    key={i}
                    className={`flex h-16 w-20 flex-col items-center justify-center rounded-xl border font-logo text-xl lg:h-20 lg:w-24 lg:text-2xl ${
                      d
                        ? "border-[var(--brand-red)]/60 bg-[rgb(225_6_0/0.12)] text-[var(--brand-red-bright)] shadow-[0_0_20px_rgb(225_6_0/0.15)]"
                        : "border-dashed border-white/10 text-zinc-700"
                    }`}
                  >
                    <span>{d ? segmentLabel(d.kind, d.number) : "—"}</span>
                    {d && (baseball || fortyOne) && (
                      <span className="font-display text-sm tabular-nums text-zinc-400">
                        {pts && pts > 0 ? `+${pts}` : "0"}
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="ml-2">
                <div className="font-display text-xs tracking-widest text-zinc-600">TURN</div>
                <div
                  className={`font-logo text-4xl tabular-nums lg:text-5xl ${
                    exact41Voided ? "text-amber-400" : "text-white"
                  }`}
                >
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
          <div
            className="relative -ml-16 origin-right scale-100 lg:-ml-28"
            style={{
              filter: "drop-shadow(0 24px 80px rgba(0,0,0,0.85))",
            }}
          >
            <Dartboard
              marks={state.currentTurnDarts}
              focusNumber={boardFocusNumber}
              focusNumbers={killerFocus?.secondary ?? null}
              focusKind={killerFocus?.focusKind ?? "wedge"}
              focusRing={f41Focus?.focusRing ?? null}
              focusBull={f41Focus?.focusBull ?? false}
              size={boardSize}
              showLiveLabel={false}
              className="relative z-10"
            />
          </div>
        </div>
      </div>

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
