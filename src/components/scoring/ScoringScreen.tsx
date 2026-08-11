"use client";

/**
 * `/play` scoring UI.
 *
 * Patron (default): thrower, scores, mode banner, current visit (tap-to-correct),
 * recent visits, dartboard, Stats + End game. Match win auto-saves (no Save dialog).
 * Board sits in a fixed stage — visit history / seats scroll and never shove it.
 * No global AppShell nav — see docs/PLAY.md.
 *
 * Staff (admin unlocked): Undo / Edit / End turn / Pause / Home + Keys/Pad.
 * Unlock: `?admin=1`, long-press logo + PIN, or Admin link.
 * End game is patron-visible (not behind admin).
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  baseballInning,
  dartPointsForMode,
  fortyOneBoardFocus,
  fortyOneDartPoints,
  fortyOneExact41DartContributes,
  fortyOneTarget,
  getHandler,
  getRemaining,
  getTeamForPlayer,
  isTeamGame,
  killerBoardFocus,
  parseDartLabel,
  segmentLabel,
} from "@/engine";
import { AuthModal, type AuthMode } from "@/components/auth/AuthModal";
import { SavedPlayersPicker } from "@/components/auth/SavedPlayersPicker";
import { MATCH_WON_AUTOSAVE_MS, shouldAutoSaveMatch } from "@/lib/match-autosave";
import { canScoreMatch } from "@/lib/seat-auth";
import { cn } from "@/lib/utils";
import { useGameStore } from "@/store/game-store";
import { usePlayersStore } from "@/store/players-store";
import { useSessionStore } from "@/store/session-store";
import { useSettingsStore } from "@/store/settings-store";
import { useCameraHealth } from "@/hooks/useCameraHealth";
import { useCameraSync } from "@/hooks/useCameraSync";
import { useMatchHeartbeat } from "@/hooks/useMatchHeartbeat";
import { usePlayAdmin } from "@/hooks/usePlayAdmin";
import { matchScoringStarted, statsHrefFromPlay } from "@/lib/play-kiosk";
import { Dartboard } from "@/components/board/Dartboard";
import { BaseballBanner } from "./BaseballBanner";
import { FortyOneBanner } from "./FortyOneBanner";
import { CameraHealthToast } from "./CameraHealthToast";
import { CheckoutBanner } from "./CheckoutBanner";
import { CorrectDartModal } from "./CorrectDartModal";
import { DartQuickKeys } from "./DartQuickKeys";
import { CalloutToast } from "./CalloutToast";
import { KillerBanner } from "./KillerBanner";
import { NumberPad } from "./NumberPad";
import { PlayAdminPinModal } from "./PlayAdminPinModal";
import { PlayerPanel } from "./PlayerPanel";
import { ResumeAuthGate } from "./ResumeAuthGate";
import { TurnDarts } from "./TurnDarts";
import { VisitHistory } from "./VisitHistory";

function ScoringScreenInner() {
  const {
    state,
    lastCallout,
    hydrate,
    throwDart,
    correctDartAt,
    editLastTurn,
    endTurn,
    undo,
    pause,
    resume,
    nextLeg,
    clearGame,
    getCheckout,
    setDisplayOnly,
  } = useGameStore();
  const settings = useSettingsStore();
  const sessionPlayer = useSessionStore((s) => s.player);
  const sessionHydrated = useSessionStore((s) => s.hydrated);
  const hydrateSession = useSessionStore((s) => s.hydrate);
  const logoutSession = useSessionStore((s) => s.logout);
  const rememberTabletPlayer = useSessionStore((s) => s.rememberTabletPlayer);
  const rememberRegistered = usePlayersStore((s) => s.rememberRegistered);
  const syncPlayers = usePlayersStore((s) => s.syncFromServer);
  const hydratePlayers = usePlayersStore((s) => s.hydrate);
  const [pad, setPad] = useState("");
  const [tab, setTab] = useState<"board" | "keys" | "pad">("board");
  const [correctSlot, setCorrectSlot] = useState<number | null>(null);
  const [boardSize, setBoardSize] = useState(320);
  const [seatAuthTick, setSeatAuthTick] = useState(0);
  const [idlePickerOpen, setIdlePickerOpen] = useState(false);
  const [idleAuthOpen, setIdleAuthOpen] = useState(false);
  const [idleAuthMode, setIdleAuthMode] = useState<AuthMode>("signin");
  const [idleAuthName, setIdleAuthName] = useState("");
  const logoPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardStageRef = useRef<HTMLDivElement>(null);

  const admin = usePlayAdmin(settings.staffPin);

  useEffect(() => {
    setDisplayOnly(false);
    hydrate();
    settings.hydrate();
    hydratePlayers();
    void hydrateSession();
  }, [hydrate, settings, setDisplayOnly, hydrateSession, hydratePlayers]);

  // Board size follows the reserved board column only — never visit/seat chrome
  useEffect(() => {
    const el = boardStageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      const side = Math.floor(Math.min(width, height) - 20);
      if (side > 0) setBoardSize(Math.max(200, Math.min(side, 440)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state?.id]);

  // Match won → auto-save (PIN players get history; guests do not) → idle. No Save dialog.
  useEffect(() => {
    if (!shouldAutoSaveMatch(state)) return;
    const id = state!.id;
    const t = setTimeout(() => {
      const cur = useGameStore.getState().state;
      if (cur?.id === id && cur.status === "match_won") {
        useGameStore.getState().finishAndSave();
      }
    }, MATCH_WON_AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [state]);

  const seatsOk = useMemo(() => {
    void seatAuthTick;
    if (!state) return true;
    if (!sessionHydrated) return false;
    return canScoreMatch(state.id, state.players, sessionPlayer?.id ?? null);
  }, [state, sessionPlayer?.id, sessionHydrated, seatAuthTick]);

  // Camera must not advance scores while PIN seats need re-auth
  useCameraSync(seatsOk);
  // Keep TV feed alive during the gate; only scoring input is blocked
  useMatchHeartbeat(true);
  const { notice: cameraNotice } = useCameraHealth(state?.roomId, Boolean(state) && seatsOk);

  const checkout = useMemo(() => (state ? getCheckout() : null), [state, getCheckout]);
  const showCheckout =
    Boolean(checkout) &&
    (state?.mode === "x01" || state?.mode === "random_checkout");

  const clearLogoPress = () => {
    if (logoPressTimer.current) {
      clearTimeout(logoPressTimer.current);
      logoPressTimer.current = null;
    }
  };

  const startLogoPress = () => {
    clearLogoPress();
    logoPressTimer.current = setTimeout(() => {
      if (admin.isAdmin) admin.lock();
      else admin.openPin();
    }, 800);
  };

  if (!state) {
    return (
      <div className="shell-black flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Image src="/brand/logo.png" alt="No.3" width={72} height={72} />
        <h1 className="font-logo text-2xl text-white">No active match</h1>
        {sessionPlayer ? (
          <p className="text-sm text-zinc-400">
            Signed in · <span className="text-white">{sessionPlayer.name}</span>
          </p>
        ) : (
          <p className="max-w-sm text-sm text-zinc-500">
            Guests can play without an account. Saved players sign in with PIN.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="btn-primary min-h-12 px-8">
            Set up a game
          </Link>
          <button
            type="button"
            className="btn-ghost min-h-12 px-6"
            onClick={() => setIdlePickerOpen(true)}
          >
            Saved players
          </button>
          <Link href={statsHrefFromPlay("/play")} className="btn-ghost min-h-12 px-6">
            Stats
          </Link>
        </div>
        {sessionPlayer && (
          <button
            type="button"
            className="text-xs text-zinc-600 hover:text-zinc-400"
            onClick={() => void logoutSession()}
          >
            Sign out
          </button>
        )}
        <SavedPlayersPicker
          open={idlePickerOpen}
          onClose={() => setIdlePickerOpen(false)}
          sessionPlayerId={sessionPlayer?.id ?? null}
          onCreateAccount={() => {
            setIdleAuthMode("register");
            setIdleAuthName("");
            setIdleAuthOpen(true);
          }}
          onPick={(p) => {
            if (sessionPlayer?.id === p.id) return;
            // Idle picker always establishes / switches the tablet session
            setIdleAuthMode("signin");
            setIdleAuthName(p.name);
            setIdleAuthOpen(true);
          }}
        />
        <AuthModal
          open={idleAuthOpen}
          mode={idleAuthMode}
          initialName={idleAuthName}
          onClose={() => setIdleAuthOpen(false)}
          onSuccess={(player) => {
            rememberRegistered(player);
            rememberTabletPlayer({ id: player.id, name: player.name });
            void syncPlayers();
            void hydrateSession();
          }}
        />
      </div>
    );
  }

  const handler = getHandler(state.mode);
  const statusLine = handler.getStatusLine?.(state) ?? state.mode;
  const current = state.players[state.currentPlayerIndex];
  const remaining = current ? getRemaining(state, current.id) : 0;
  const currentTeam = current ? getTeamForPlayer(state, current.id) : null;
  const killerFocus = state.mode === "killer" ? killerBoardFocus(state) : null;
  const slotDart =
    correctSlot != null ? state.currentTurnDarts[correctSlot] : undefined;
  const fortyOne = state.mode === "forty_one";
  const fortyOneFocus = fortyOne ? fortyOneBoardFocus(fortyOneTarget(state)) : null;
  const baseball = state.mode === "baseball";
  const boardFocusNumber = baseball
    ? baseballInning(state)
    : (killerFocus?.primary ?? fortyOneFocus?.focusNumber ?? null);
  const isAdmin = admin.isAdmin;
  const modeInning = state.mode === "baseball" ? baseballInning(state) : undefined;
  const playing = state.status === "playing";

  const endGame = () => {
    if (!state) return;
    if (
      matchScoringStarted(state) &&
      !confirm("End this game? Scores will not be saved.")
    ) {
      return;
    }
    clearGame();
  };

  const submitPad = () => {
    const dart = parseDartLabel(pad);
    if (dart) {
      throwDart(dart.kind, dart.number);
      setPad("");
      return;
    }
    const n = parseInt(pad, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 60) {
      if (n === 0) throwDart("miss", 0);
      else if (n === 25) throwDart("outer_bull", 25);
      else if (n === 50) throwDart("bull", 50);
      else if (n <= 20) throwDart("single", n);
      else {
        for (let i = 20; i >= 1; i--) {
          if (i * 3 === n) {
            throwDart("triple", i);
            setPad("");
            return;
          }
          if (i * 2 === n) {
            throwDart("double", i);
            setPad("");
            return;
          }
        }
      }
      setPad("");
    }
  };

  const boardNode =
    playing && (!isAdmin || tab === "board") ? (
      <Dartboard
        marks={state.currentTurnDarts}
        focusNumber={boardFocusNumber}
        focusNumbers={killerFocus?.secondary ?? null}
        focusKind={killerFocus?.focusKind ?? "wedge"}
        focusRing={fortyOneFocus?.focusRing ?? null}
        focusBull={fortyOneFocus?.focusBull ?? false}
        size={boardSize}
        interactive
        showLiveLabel
        onScore={(kind, number, meta) => {
          throwDart(kind, number, {
            angle: meta?.angle,
            radius: meta?.radius,
            source: "manual",
          });
        }}
      />
    ) : null;

  return (
    <div className="play-match flex flex-col">
      <CalloutToast message={lastCallout} />
      <CameraHealthToast notice={cameraNotice} />

      {!seatsOk && (
        <ResumeAuthGate
          matchId={state.id}
          players={state.players}
          onVerifiedChange={() => setSeatAuthTick((t) => t + 1)}
        />
      )}

      {admin.pinOpen && (
        <PlayAdminPinModal
          tryPin={admin.tryPin}
          onSuccess={() => admin.unlock()}
          onClose={admin.closePin}
        />
      )}

      {correctSlot != null && (
        <CorrectDartModal
          slotIndex={correctSlot}
          currentLabel={
            slotDart ? segmentLabel(slotDart.kind, slotDart.number) : undefined
          }
          focusNumber={boardFocusNumber}
          focusRing={fortyOneFocus?.focusRing ?? null}
          focusBull={fortyOneFocus?.focusBull ?? false}
          onPick={(kind, number) => {
            correctDartAt(correctSlot, kind, number);
            setCorrectSlot(null);
          }}
          onClear={() => {
            correctDartAt(correctSlot, null);
            setCorrectSlot(null);
          }}
          onClose={() => setCorrectSlot(null)}
        />
      )}

      {/* Top bar — thrower + score; staff tools only when unlocked */}
      <header className="shrink-0 border-b border-[rgb(225_6_0/0.22)] bg-[#050505] px-3 py-2">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <button
            type="button"
            className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]"
            aria-label={isAdmin ? "Lock staff controls" : "Staff unlock (long press)"}
            onPointerDown={startLogoPress}
            onPointerUp={clearLogoPress}
            onPointerLeave={clearLogoPress}
            onPointerCancel={clearLogoPress}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Image src="/brand/logo.png" alt="" width={36} height={36} className="rounded-full" />
          </button>
          <div className="min-w-0 flex-1">
            {isTeamGame(state) && currentTeam && currentTeam.playerIds.length > 1 && (
              <div className="truncate font-display text-sm font-bold tracking-wide text-[var(--brand-red-bright)]">
                {currentTeam.name}
              </div>
            )}
            <div className="truncate font-display text-base font-bold tracking-wide text-white sm:text-lg">
              {current?.name}
              <span className="ml-2 font-normal text-zinc-500">throws</span>
              {(state.mode === "x01" || state.mode === "random_checkout") && (
                <span className="ml-3 tabular-nums text-[var(--brand-red-bright)]">{remaining}</span>
              )}
            </div>
            <div className="truncate text-xs text-zinc-500">
              {statusLine} · Leg {state.legNumber}
              {lastCallout ? ` · ${lastCallout}` : ""}
              {isAdmin ? " · Staff" : ""}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <Link
              href={statsHrefFromPlay("/play")}
              className="btn-ghost min-h-10 px-3 font-display text-xs tracking-wider text-zinc-300"
            >
              Stats
            </Link>
            <button
              type="button"
              onClick={endGame}
              className="btn-ghost min-h-11 px-3 font-display text-xs tracking-wider text-red-300"
            >
              End game
            </button>
            {isAdmin ? (
              <>
                <button type="button" onClick={undo} className="btn-ghost min-h-10 px-3 text-xs">
                  Undo
                </button>
                <button type="button" onClick={editLastTurn} className="btn-ghost min-h-10 px-3 text-xs">
                  Edit
                </button>
                <button type="button" onClick={endTurn} className="btn-ghost min-h-10 px-3 text-xs">
                  End turn
                </button>
                {playing ? (
                  <button type="button" onClick={pause} className="btn-ghost min-h-10 px-3 text-xs">
                    ‖
                  </button>
                ) : state.status === "paused" ? (
                  <button type="button" onClick={resume} className="btn-primary min-h-10 px-3 text-xs">
                    ▶
                  </button>
                ) : null}
                <Link href="/" className="btn-ghost min-h-10 px-3 text-xs">
                  Setup
                </Link>
                <button type="button" onClick={admin.lock} className="btn-ghost min-h-10 px-3 text-xs">
                  Lock
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={admin.openPin}
                className="shrink-0 font-display text-[10px] tracking-wider text-zinc-700 hover:text-zinc-500"
              >
                Admin
              </button>
            )}
          </div>
        </div>
      </header>

      {/*
        Stable match grid:
        - Landscape / iPad: scrollable chrome | fixed board column
        - Portrait: compact scroll seats → fixed board band → scroll visit/footer
        Board stage size is independent of visit history / checkout / seat count.
      */}
      <main
        className={cn(
          "mx-auto grid w-full max-w-6xl flex-1 min-h-0 gap-2 px-2 py-2",
          // Portrait: scrollable chrome on top, fixed board band below
          "grid-rows-[minmax(0,1fr)_minmax(240px,46%)]",
          // Landscape / iPad: chrome | fixed board column
          "md:grid-cols-[minmax(0,1fr)_minmax(280px,44%)] md:grid-rows-1"
        )}
      >
        {/* Chrome column — seats, banners, visit, actions (scrolls) */}
        <section className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain md:order-1 md:pr-1">
          <PlayerPanel state={state} compact />

          {state.mode === "baseball" && <BaseballBanner state={state} size="sm" />}
          {state.mode === "killer" && <KillerBanner state={state} size="sm" />}
          {fortyOne && <FortyOneBanner state={state} size="sm" />}

          {showCheckout && playing && <CheckoutBanner suggestion={checkout} />}

          <div className="rounded-xl border border-[rgb(225_6_0/0.28)] bg-[#0a0a0a] px-3 py-2">
            <div className="mb-1 font-display text-[10px] tracking-[0.18em] text-zinc-500">
              THIS VISIT
            </div>
            <TurnDarts
              darts={state.currentTurnDarts}
              interactive={playing}
              onSlotClick={(i) => setCorrectSlot(i)}
              showDartPoints={baseball || fortyOne}
              pointsForDart={
                baseball
                  ? (d) => dartPointsForMode("baseball", d, { inning: modeInning })
                  : fortyOne
                    ? (d) => fortyOneDartPoints(d, fortyOneTarget(state))
                    : undefined
              }
              totalVoided={
                fortyOne &&
                fortyOneTarget(state).type === "exact_41" &&
                state.currentTurnDarts.some((d) => !fortyOneExact41DartContributes(d))
              }
            />
            {playing && (
              <p className="mt-1 text-[10px] tracking-wide text-zinc-600">
                Tap a dart to fix
              </p>
            )}
          </div>

          <VisitHistory state={state} limit={12} size="sm" className="shrink-0" />

          {(state.status === "leg_won" || state.status === "match_won") && (
            <div className="rounded-xl border border-[rgb(225_6_0/0.45)] bg-[rgb(225_6_0/0.12)] p-4 text-center">
              <div className="font-logo text-2xl text-[var(--brand-red-bright)]">
                {state.status === "match_won" ? "MATCH" : "LEG"} ·{" "}
                {(() => {
                  const wid = state.winnerId ?? state.legWinnerId;
                  if (!wid) return "—";
                  const team = getTeamForPlayer(state, wid);
                  return team && team.playerIds.length > 1
                    ? team.name
                    : state.players.find((p) => p.id === wid)?.name;
                })()}
              </div>
              {state.status === "match_won" ? (
                <p className="mt-2 text-sm text-zinc-400">Saving…</p>
              ) : (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={nextLeg} className="btn-primary min-h-11 px-6">
                    Next leg
                  </button>
                  <button
                    type="button"
                    onClick={endGame}
                    className="btn-ghost min-h-11 px-6 text-red-300"
                  >
                    End game
                  </button>
                </div>
              )}
            </div>
          )}

          {playing && isAdmin && (
            <div className="flex gap-1 rounded-lg border border-[var(--panel-border)] bg-[#0a0a0a] p-0.5">
              {(
                [
                  ["board", "Board"],
                  ["keys", "Keys"],
                  ["pad", "Pad"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "min-h-9 flex-1 rounded-md font-display text-xs tracking-wider",
                    tab === id ? "bg-[var(--brand-red)] text-white" : "text-zinc-500"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {playing && isAdmin && tab === "keys" && (
            <div className="w-full max-w-lg md:hidden">
              <DartQuickKeys onDart={(k, n) => throwDart(k, n)} />
            </div>
          )}
          {playing && isAdmin && tab === "pad" && (
            <div className="w-full max-w-xs md:hidden">
              <NumberPad
                value={pad}
                onNumber={(n) => setPad((v) => (v + String(n)).slice(0, 4))}
                onClear={() => setPad("")}
                onSubmit={submitPad}
              />
            </div>
          )}

          <button
            type="button"
            onClick={endGame}
            className="btn-ghost mt-auto min-h-12 w-full border border-[rgb(225_6_0/0.35)] font-display text-sm tracking-wider text-red-300"
          >
            End game
          </button>
        </section>

        {/* Fixed board column — size from this cell only; history/seats never shove it */}
        <section
          ref={boardStageRef}
          className={cn(
            "flex min-h-0 min-w-0 flex-col items-center justify-center rounded-2xl border border-[rgb(225_6_0/0.2)] bg-black px-2 py-2 md:order-2",
            !playing && "opacity-80"
          )}
        >
          {boardNode}
          {playing && isAdmin && tab === "keys" && (
            <div className="hidden w-full max-w-lg md:block">
              <DartQuickKeys onDart={(k, n) => throwDart(k, n)} />
            </div>
          )}
          {playing && isAdmin && tab === "pad" && (
            <div className="hidden w-full max-w-xs md:block">
              <NumberPad
                value={pad}
                onNumber={(n) => setPad((v) => (v + String(n)).slice(0, 4))}
                onClear={() => setPad("")}
                onSubmit={submitPad}
              />
            </div>
          )}
          {!playing && (
            <div className="px-4 text-center font-display text-sm tracking-wider text-zinc-600">
              Board idle
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export function ScoringScreen() {
  return (
    <Suspense
      fallback={
        <div className="shell-black flex items-center justify-center text-zinc-500">
          Loading…
        </div>
      }
    >
      <ScoringScreenInner />
    </Suspense>
  );
}
