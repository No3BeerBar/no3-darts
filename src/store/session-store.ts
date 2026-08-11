"use client";

import { create } from "zustand";
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

interface SessionStore {
  player: SessionPlayer | null;
  /** PIN-verified on this tablet until Sign out / idle logout */
  tabletPlayers: TabletSessionPlayer[];
  dbConfigured: boolean;
  dbAvailable: boolean;
  hydrated: boolean;
  loading: boolean;
  hydrate: () => Promise<void>;
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

  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
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
      } else {
        // No cookie → cold start (Saved players picker); clear quick-add roster
        clearTabletSessionPlayers();
      }
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
