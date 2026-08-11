"use client";

import { create } from "zustand";
import { createId } from "@/engine";
import {
  deletePlayer as storageDelete,
  getPlayers,
  savePlayers,
  type StoredPlayer,
  upsertPlayer,
} from "@/lib/storage";
import type { SessionPlayer } from "@/store/session-store";

interface PlayersStore {
  players: StoredPlayer[];
  hydrated: boolean;
  dbAvailable: boolean;
  /** Ids known to exist on the server (PIN accounts) */
  registeredIds: string[];
  hydrate: () => void;
  /** Merge server-registered players into local picker cache */
  syncFromServer: () => Promise<void>;
  rememberRegistered: (player: SessionPlayer) => StoredPlayer;
  addPlayer: (name: string, isGuest?: boolean) => StoredPlayer;
  removePlayer: (id: string) => void;
  refresh: () => void;
  isRegistered: (id: string) => boolean;
}

function emptyStats() {
  return {
    matchesPlayed: 0,
    matchesWon: 0,
    legsWon: 0,
    dartsThrown: 0,
    totalScore: 0,
    oneEighties: 0,
    checkoutsHit: 0,
    checkoutAttempts: 0,
    highestCheckout: 0,
    bestThreeDartAvg: 0,
  };
}

export const usePlayersStore = create<PlayersStore>((set, get) => ({
  players: [],
  hydrated: false,
  dbAvailable: false,
  registeredIds: [],

  hydrate: () => {
    if (get().hydrated) return;
    set({ players: getPlayers(), hydrated: true });
    void get().syncFromServer();
  },

  refresh: () => set({ players: getPlayers() }),

  isRegistered: (id) => get().registeredIds.includes(id),

  syncFromServer: async () => {
    try {
      const res = await fetch("/api/players", { credentials: "include" });
      const data = (await res.json()) as {
        ok: boolean;
        players?: SessionPlayer[];
        dbAvailable?: boolean;
      };
      set({ dbAvailable: Boolean(data.dbAvailable) });
      if (!data.ok || !data.players) return;

      const local = getPlayers();
      const byId = new Map(local.map((p) => [p.id, p]));
      for (const sp of data.players) {
        const existing = byId.get(sp.id);
        byId.set(sp.id, {
          id: sp.id,
          name: sp.name,
          isGuest: false,
          createdAt: existing?.createdAt ?? sp.createdAt,
          // Server aggregates win when DB is up
          stats: sp.stats ?? existing?.stats ?? emptyStats(),
        });
      }
      savePlayers(Array.from(byId.values()));
      set({
        players: getPlayers(),
        registeredIds: data.players.map((p) => p.id),
      });
    } catch {
      set({ dbAvailable: false });
    }
  },

  rememberRegistered: (player) => {
    const stored = upsertPlayer({
      id: player.id,
      name: player.name,
      isGuest: false,
      createdAt: player.createdAt,
      stats: player.stats,
    });
    const registeredIds = get().registeredIds.includes(player.id)
      ? get().registeredIds
      : [...get().registeredIds, player.id];
    set({ players: getPlayers(), registeredIds });
    return stored;
  },

  addPlayer: (name, isGuest = false) => {
    const player = upsertPlayer({
      id: createId("player"),
      name: name.trim() || "Player",
      isGuest,
    });
    set({ players: getPlayers() });
    return player;
  },

  removePlayer: (id) => {
    storageDelete(id);
    set({ players: getPlayers() });
  },
}));
