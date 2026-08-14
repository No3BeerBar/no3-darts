"use client";

import { create } from "zustand";
import {
  clearPlayEntrySessionCookie,
  gatePlayDocumentEntry,
} from "@/lib/play-entry-gate";
import { invalidateSeat } from "@/lib/seat-auth";
import type { PlayerAggregateStats } from "@/lib/storage";
import {
  clearTabletSessionPlayers,
  getTabletSessionPlayers,
  rememberTabletSessionPlayer,
  type TabletSessionPlayer,
} from "@/lib/tablet-session";

export type SessionPlayer = {
  id: string;
  name: string;
  createdAt: number;
  stats: PlayerAggregateStats;
};

export type SessionHydrateOpts = {
  /**
   * Fresh mount of `/play` or setup `/`. Once per document load, clears sticky
   * cookie + tablet roster + seat scoring trust so the board link never looks
   * signed in without PIN. SPA re-hydrates after PIN omit this (or pass false).
   */
  playEntry?: boolean;
};

interface SessionStore {
  player: SessionPlayer | null;
  /** PIN-verified on this tablet until Sign out / idle logout */
  tabletPlayers: TabletSessionPlayer[];
  dbConfigured: boolean;
  dbAvailable: boolean;
  hydrated: boolean;
  loading: boolean;
  hydrate: (opts?: SessionHydrateOpts) => Promise<void>;
  setPlayer: (player: SessionPlayer | null) => void;
  rememberTabletPlayer: (player: { id: string; name: string }) => void;
  logout: () => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  player: null,
  tabletPlayers: [],
  dbConfigured: false,
  dbAvailable: false,
  hydrated: false,
  loading: false,

  hydrate: async (opts) => {
    if (get().loading) return;
    set({ loading: true });
    try {
      // Board bookmark / app restart: fail-closed cold tablet before trusting cookie.
      if (opts?.playEntry) {
        const { gated } = gatePlayDocumentEntry();
        if (gated) {
          await clearPlayEntrySessionCookie();
          clearTabletSessionPlayers();
          let dbConfigured = false;
          let dbAvailable = false;
          try {
            const listRes = await fetch("/api/players", { credentials: "include" });
            const list = (await listRes.json()) as {
              dbConfigured?: boolean;
              dbAvailable?: boolean;
            };
            dbConfigured = Boolean(list.dbConfigured);
            dbAvailable = Boolean(list.dbAvailable);
          } catch {
            /* offline */
          }
          set({
            player: null,
            tabletPlayers: [],
            dbConfigured,
            dbAvailable,
            hydrated: true,
            loading: false,
          });
          return;
        }
      }

      const meRes = await fetch("/api/auth/me", { credentials: "include" });
      const me = (await meRes.json()) as {
        ok: boolean;
        player: SessionPlayer | null;
        dbConfigured?: boolean;
      };
      const listRes = await fetch("/api/players", { credentials: "include" });
      const list = (await listRes.json()) as {
        dbConfigured?: boolean;
        dbAvailable?: boolean;
      };
      const prevId = get().player?.id ?? null;
      const nextPlayer = me.player ?? null;
      // Session cookie gone / different account — drop that seat's resume trust
      if (prevId && prevId !== nextPlayer?.id) {
        invalidateSeat(prevId);
      }
      if (nextPlayer) {
        rememberTabletSessionPlayer({ id: nextPlayer.id, name: nextPlayer.name });
      }
      // Do not wipe the tablet roster when the cookie is empty — every PIN
      // seat from the last match must stay on idle / next-game setup.
      // Logout and the once-per-document play-entry gate still clear.
      set({
        player: nextPlayer,
        tabletPlayers: getTabletSessionPlayers(),
        dbConfigured: Boolean(me.dbConfigured ?? list.dbConfigured),
        dbAvailable: Boolean(list.dbAvailable),
        hydrated: true,
        loading: false,
      });
    } catch {
      set({
        hydrated: true,
        loading: false,
        dbAvailable: false,
        tabletPlayers: getTabletSessionPlayers(),
      });
    }
  },

  setPlayer: (player) => {
    if (player) {
      rememberTabletSessionPlayer({ id: player.id, name: player.name });
      set({ player, tabletPlayers: getTabletSessionPlayers() });
      return;
    }
    set({ player: null });
  },

  rememberTabletPlayer: (player) => {
    rememberTabletSessionPlayer(player);
    set({ tabletPlayers: getTabletSessionPlayers() });
  },

  logout: async () => {
    const id = get().player?.id;
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignore */
    }
    if (id) invalidateSeat(id);
    clearTabletSessionPlayers();
    set({ player: null, tabletPlayers: [] });
  },
}));
