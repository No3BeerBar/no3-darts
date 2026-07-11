"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  getHandler,
  getRemaining,
  getTeamForPlayer,
  isTeamGame,
  parseDartLabel,
  segmentLabel,
} from "@/engine";
import { useGameStore } from "@/store/game-store";
import { useSettingsStore } from "@/store/settings-store";
import { useCameraSync } from "@/hooks/useCameraSync";
import { useMatchHeartbeat } from "@/hooks/useMatchHeartbeat";
import { Dartboard } from "@/components/board/Dartboard";
import { CorrectDartModal } from "./CorrectDartModal";
import { DartQuickKeys } from "./DartQuickKeys";
import { CalloutToast } from "./CalloutToast";
import { NumberPad } from "./NumberPad";
import { PlayerPanel } from "./PlayerPanel";
import { TurnDarts } from "./TurnDarts";
import { VisitHistory } from "./VisitHistory";
import { cn } from "@/lib/utils";

export function ScoringScreen() {
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
    finishAndSave,
    clearGame,
    getCheckout,
    setDisplayOnly,
  } = useGameStore();
  const settings = useSettingsStore();
  const [pad, setPad] = useState("");
  const [tab, setTab] = useState<"board" | "keys" | "pad">("board");
  const [correctSlot, setCorrectSlot] = useState<number | null>(null);
  const [boardSize, setBoardSize] = useState(340);

  useEffect(() => {
    setDisplayOnly(false);
    hydrate();
    settings.hydrate();
  }, [hydrate, settings, setDisplayOnly]);

  useEffect(() => {
    const fit = () => {
      // Fit board under larger score chrome + visit history
      const w = Math.min(window.innerWidth - 24, 400);
      const h = window.innerHeight - 340;
      setBoardSize(Math.max(240, Math.min(w, h, 380)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useCameraSync(true);
  // Re-publish match to server so TV recovers after deploys / refreshes
  useMatchHeartbeat(true);

  const checkout = useMemo(() => (state ? getCheckout() : null), [state, getCheckout]);

  if (!state) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <Image src="/brand/logo.png" alt="No.3" width={72} height={72} />
        <h1 className="font-logo text-2xl text-white">No active match</h1>
        <Link href="/" className="btn-primary min-h-12 px-8">
          Set up a game
        </Link>
      </div>
    );
  }

  const handler = getHandler(state.mode);
  const statusLine = handler.getStatusLine?.(state) ?? state.mode;
  const current = state.players[state.currentPlayerIndex];
  const remaining = current ? getRemaining(state, current.id) : 0;
  const currentTeam = current ? getTeamForPlayer(state, current.id) : null;
  const slotDart =
    correctSlot != null ? state.currentTurnDarts[correctSlot] : undefined;

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

  return (
    <div className="flex min-h-dvh flex-col text-zinc-100">
      <CalloutToast message={lastCallout} />

      {correctSlot != null && (
        <CorrectDartModal
          slotIndex={correctSlot}
          currentLabel={
            slotDart ? segmentLabel(slotDart.kind, slotDart.number) : undefined
          }
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

      {/* Top bar — thrower prominent */}
      <header className="shrink-0 border-b border-[rgb(225_6_0/0.2)] bg-black/85 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Image src="/brand/logo.png" alt="" width={36} height={36} className="rounded-full" />
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
            <div className="truncate text-xs text-zinc-600">
              {statusLine} · Leg {state.legNumber}
              {lastCallout ? ` · ${lastCallout}` : ""}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <button type="button" onClick={undo} className="btn-ghost min-h-10 px-3 text-xs">
              Undo
            </button>
            <button type="button" onClick={editLastTurn} className="btn-ghost min-h-10 px-3 text-xs">
              Edit
            </button>
            <button type="button" onClick={endTurn} className="btn-ghost min-h-10 px-3 text-xs">
              End
            </button>
            {state.status === "playing" ? (
              <button type="button" onClick={pause} className="btn-ghost min-h-10 px-3 text-xs">
                ‖
              </button>
            ) : state.status === "paused" ? (
              <button type="button" onClick={resume} className="btn-primary min-h-10 px-3 text-xs">
                ▶
              </button>
            ) : null}
            <button
              type="button"
              className="btn-ghost min-h-10 px-3 text-xs text-red-300"
              onClick={() => {
                if (confirm("Cancel match?")) clearGame();
              }}
            >
              ✕
            </button>
            <Link href="/" className="btn-ghost min-h-10 px-3 text-xs">
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-2.5 px-2 py-2">
        <PlayerPanel state={state} compact />

        {/* Current visit */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-[#121212]/70 px-3 py-2">
          <TurnDarts
            darts={state.currentTurnDarts}
            interactive={state.status === "playing"}
            onSlotClick={(i) => setCorrectSlot(i)}
          />
          {checkout && (
            <div className="text-right">
              <div className="font-display text-[10px] tracking-wider text-zinc-500">Checkout</div>
              <div className="font-display text-base font-bold text-[var(--brand-red-bright)]">
                {checkout.description}
              </div>
            </div>
          )}
        </div>

        {/* Previous rounds / visits */}
        <VisitHistory state={state} limit={8} size="sm" />

        {(state.status === "leg_won" || state.status === "match_won") && (
          <div className="rounded-xl border border-[rgb(225_6_0/0.4)] bg-[rgb(225_6_0/0.1)] p-4 text-center">
            <div className="font-logo text-2xl text-[var(--brand-red-bright)]">
              {state.status === "match_won" ? "MATCH" : "LEG"} ·{" "}
              {(() => {
                const wid = state.winnerId ?? state.legWinnerId;
                if (!wid) return "—";
                const team = getTeamForPlayer(state, wid);
                return team && team.playerIds.length > 1 ? team.name : state.players.find((p) => p.id === wid)?.name;
              })()}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {state.status === "leg_won" && (
                <button type="button" onClick={nextLeg} className="btn-primary min-h-11 px-6">
                  Next leg
                </button>
              )}
              <button type="button" onClick={finishAndSave} className="btn-primary min-h-11 px-6">
                Save
              </button>
              <button type="button" onClick={clearGame} className="btn-ghost min-h-11 px-6">
                Discard
              </button>
            </div>
          </div>
        )}

        {state.status === "playing" && (
          <>
            <div className="flex gap-1 rounded-lg bg-[#121212] p-0.5">
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

            <div className="flex flex-1 flex-col items-center justify-center pb-2">
              {tab === "board" && (
                <Dartboard
                  marks={state.currentTurnDarts}
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
              )}
              {tab === "keys" && (
                <div className="w-full max-w-lg">
                  <DartQuickKeys onDart={(k, n) => throwDart(k, n)} />
                </div>
              )}
              {tab === "pad" && (
                <div className="w-full max-w-xs">
                  <NumberPad
                    value={pad}
                    onNumber={(n) => setPad((v) => (v + String(n)).slice(0, 4))}
                    onClear={() => setPad("")}
                    onSubmit={submitPad}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
