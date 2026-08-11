"use client";

import { create } from "zustand";
import type { PlayerAggregateStats } from "@/lib/storage";

export type SessionPlayer = {
  id: string;
  name: string;
  createdAt: number;
  stats: PlayerAggregateStats;
};

interface SessionStore {
  player: SessionPlayer | null;
  dbConfigured: boolean;
  dbAvailable: boolean;
  hydrated: boolean;
  loading: boolean;
  hydrate: () => Promise<void>;
  setPlayer: (player: SessionPlayer | null) => void;
  logout: () => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  player: null,
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
      set({
        player: me.player ?? null,
        dbConfigured: Boolean(me.dbConfigured ?? list.dbConfigured),
        dbAvailable: Boolean(list.dbAvailable),
        hydrated: true,
        loading: false,
      });
    } catch {
      set({ hydrated: true, loading: false, dbAvailable: false });
    }
  },

  setPlayer: (player) => set({ player }),

  logout: async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignore */
    }
    set({ player: null });
  },
}));
