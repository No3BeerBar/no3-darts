"use client";

import { create } from "zustand";
import { DEFAULT_SETTINGS, getSettings, saveSettings, type AppSettings } from "@/lib/storage";

interface SettingsStore extends AppSettings {
  hydrated: boolean;
  hydrate: () => void;
  update: (partial: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ ...getSettings(), hydrated: true });
  },

  update: (partial) => {
    const next = saveSettings(partial);
    set({ ...next });
  },
}));
