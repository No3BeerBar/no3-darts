"use client";

import { create } from "zustand";
import {
  applyDart,
  correctTurnDartAt,
  createDart,
  createGame,
  editLastTurn,
  endTurn,
  pauseGame,
  resumeGame,
  startNextLeg,
  suggestCheckout,
  undo,
  type CheckoutSuggestion,
  type CreateGameOptions,
  type DartThrow,
  type GameState,
  type SegmentKind,
} from "@/engine";
import { buildStoredMatch, hasRegisteredPlayers } from "@/lib/match-export";
import { persistMatchToServer } from "@/lib/persist-match";
import {
  canScoreMatch,
  clearSeatAuth,
  seedSeatAuthForMatch,
} from "@/lib/seat-auth";
import { getActiveGame, mergeMatchStatsIntoPlayers, saveMatch, setActiveGame } from "@/lib/storage";
import { syncMatchToServer } from "@/lib/sync-server";
import { useSessionStore } from "@/store/session-store";

/** Save history / stats / Postgres only when a PIN account played. Guests are ephemeral. */
function recordFinishedMatch(stored: ReturnType<typeof buildStoredMatch>): void {
  if (!hasRegisteredPlayers(stored)) return;
  saveMatch(stored);
  mergeMatchStatsIntoPlayers(stored);
  void persistMatchToServer(stored);
}

interface GameStore {
  state: GameState | null;
  lastCallout: string | null;
  lastHighlight: DartThrow | null;
  hydrated: boolean;
  /** When true, this client only displays (TV) and never writes */
  displayOnly: boolean;

  hydrate: () => void;
  setDisplayOnly: (v: boolean) => void;
  startGame: (opts: CreateGameOptions) => void;
  throwDart: (kind: SegmentKind, number: number, extra?: Partial<DartThrow>) => void;
  throwDartObject: (dart: DartThrow) => void;
  /** Autodarts-style: set/replace/clear dart at slot 0–2 */
  correctDartAt: (index: number, kind: SegmentKind | null, number?: number) => void;
  editLastTurn: () => void;
  endTurn: () => void;
  undo: () => void;
  pause: () => void;
  resume: () => void;
  nextLeg: () => void;
  finishAndSave: () => void;
  clearGame: () => void;
  /** Apply remote state (TV / multi-device) without re-posting loops when displayOnly */
  setState: (state: GameState | null, opts?: { localOnly?: boolean }) => void;
  getCheckout: () => CheckoutSuggestion | null;
}

function persist(state: GameState | null, skipServer = false) {
  setActiveGame(state);
  if (state && !skipServer) {
    void syncMatchToServer(state);
  }
}

/** Block scoring mutations when registered seats are no longer verified. */
function assertSeatsVerified(state: GameState): boolean {
  const sessionId = useSessionStore.getState().player?.id ?? null;
  return canScoreMatch(state.id, state.players, sessionId);
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  lastCallout: null,
  lastHighlight: null,
  hydrated: false,
  displayOnly: false,

  hydrate: () => {
    if (get().hydrated) return;
    const active = getActiveGame();
    set({ state: active, hydrated: true });
    // Re-publish to server after reload / deploy so TV can reconnect
    if (
      active &&
      (active.status === "playing" ||
        active.status === "paused" ||
        active.status === "leg_won" ||
        active.status === "match_won")
    ) {
      void syncMatchToServer(active);
    }
  },

  setDisplayOnly: (v) => set({ displayOnly: v }),

  startGame: (opts) => {
    if (get().displayOnly) return;
    const state = createGame(opts);
    const sessionId = useSessionStore.getState().player?.id ?? null;
    seedSeatAuthForMatch(state.id, state.players, sessionId);
    persist(state);
    set({ state, lastCallout: "Game on!", lastHighlight: null });
  },

  throwDart: (kind, number, extra) => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state || state.status !== "playing") return;
    if (!assertSeatsVerified(state)) return;
    const dart = createDart(kind, number, { ...extra, source: extra?.source ?? "manual" });
    get().throwDartObject(dart);
  },

  throwDartObject: (dart) => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state || state.status !== "playing") return;
    if (!assertSeatsVerified(state)) return;
    const result = applyDart(state, dart);
    persist(result.state);
    set({
      state: result.state,
      lastCallout: result.callout ?? null,
      lastHighlight: dart,
    });

    if (result.state.status === "match_won") {
      recordFinishedMatch(buildStoredMatch(result.state));
    }
  },

  correctDartAt: (index, kind, number = 0) => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state || state.status !== "playing") return;
    if (!assertSeatsVerified(state)) return;
    const dart = kind === null ? null : createDart(kind, number, { source: "manual" });
    const result = correctTurnDartAt(state, index, dart);
    persist(result.state);
    set({
      state: result.state,
      lastCallout: result.callout ?? "Corrected",
      lastHighlight: dart,
    });
  },

  editLastTurn: () => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state) return;
    if (!assertSeatsVerified(state)) return;
    const result = editLastTurn(state);
    persist(result.state);
    set({
      state: result.state,
      lastCallout: result.callout ?? "Edit visit",
      lastHighlight: null,
    });
  },

  endTurn: () => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state) return;
    if (!assertSeatsVerified(state)) return;
    const result = endTurn(state);
    persist(result.state);
    set({ state: result.state, lastCallout: result.callout ?? "Turn end" });
  },

  undo: () => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state) return;
    if (!assertSeatsVerified(state)) return;
    const result = undo(state);
    persist(result.state);
    set({ state: result.state, lastCallout: result.callout ?? "Undo", lastHighlight: null });
  },

  pause: () => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state) return;
    const next = pauseGame(state);
    persist(next);
    set({ state: next, lastCallout: "Paused" });
  },

  resume: () => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state) return;
    const next = resumeGame(state);
    persist(next);
    set({ state: next, lastCallout: "Resumed" });
  },

  nextLeg: () => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state) return;
    if (!assertSeatsVerified(state)) return;
    const next = startNextLeg(state);
    persist(next);
    set({ state: next, lastCallout: `Leg ${next.legNumber}`, lastHighlight: null });
  },

  finishAndSave: () => {
    if (get().displayOnly) return;
    const { state } = get();
    if (!state) return;
    if (!assertSeatsVerified(state)) return;
    const prevId = state.id;
    const finished = { ...state, status: "finished" as const, updatedAt: Date.now() };
    recordFinishedMatch(buildStoredMatch(finished));
    clearSeatAuth();
    persist(null);
    set({ state: null, lastCallout: null, lastHighlight: null });
    // Drop server copy so TV returns to attract mode
    if (prevId) {
      void fetch(`/api/matches/${prevId}`, { method: "DELETE" }).catch(() => {});
    }
  },

  clearGame: () => {
    if (get().displayOnly) return;
    const prev = get().state;
    clearSeatAuth();
    persist(null);
    set({ state: null, lastCallout: null, lastHighlight: null });
    // Drop server copy so TV stops showing the match
    if (prev?.id) {
      void fetch(`/api/matches/${prev.id}`, { method: "DELETE" }).catch(() => {});
    }
  },

  setState: (state, opts) => {
    // Camera / remote sync must not advance a match when PIN seats need re-auth
    if (
      state &&
      !get().displayOnly &&
      !assertSeatsVerified(state)
    ) {
      return;
    }
    if (get().displayOnly || opts?.localOnly) {
      setActiveGame(state);
      set({ state });
      return;
    }
    persist(state);
    set({ state });
  },

  getCheckout: () => {
    const { state } = get();
    if (!state) return null;
    return suggestCheckout(state);
  },
}));
