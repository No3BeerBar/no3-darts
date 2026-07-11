"use client";

import { create } from "zustand";
import { createId } from "@/engine";
import {
  deletePlayer as storageDelete,
  getPlayers,
  type StoredPlayer,
  upsertPlayer,
} from "@/lib/storage";

interface PlayersStore {
  players: StoredPlayer[];
  hydrated: boolean;
  hydrate: () => void;
  addPlayer: (name: string, isGuest?: boolean) => StoredPlayer;
  removePlayer: (id: string) => void;
  refresh: () => void;
}

export const usePlayersStore = create<PlayersStore>((set, get) => ({
  players: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ players: getPlayers(), hydrated: true });
  },

  refresh: () => set({ players: getPlayers() }),

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
