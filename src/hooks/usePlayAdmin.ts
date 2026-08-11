"use client";

/**
 * Patron `/play` vs staff admin chrome.
 *
 * Default: kiosk / patron — big scores, thrower, mode banner, current visit
 * (tap-to-correct), recent visits, board. No Undo/Edit/End/Pause/Cancel/Home
 * or Keys/Pad tabs.
 *
 * Unlock staff tools via: `?admin=1`, long-press logo + PIN, or Admin link.
 * Session kept in sessionStorage for the tab.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_STAFF_PIN } from "@/lib/auth/staff-constants";

export { DEFAULT_STAFF_PIN };

const STORAGE_KEY = "no3_play_admin";

export function usePlayAdmin(staffPin: string) {
  const searchParams = useSearchParams();
  const [unlocked, setUnlocked] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const unlock = useCallback(() => {
    setUnlocked(true);
    setPinOpen(false);
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const lock = useCallback(() => {
    setUnlocked(false);
    setPinOpen(false);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") {
        setUnlocked(true);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (searchParams.get("admin") === "1") {
      unlock();
    }
  }, [hydrated, searchParams, unlock]);

  const expectedPin = (staffPin || DEFAULT_STAFF_PIN).trim();

  const tryPin = useCallback(
    (pin: string) => {
      if (pin === expectedPin) {
        unlock();
        return true;
      }
      return false;
    },
    [expectedPin, unlock]
  );

  return {
    isAdmin: unlocked,
    pinOpen,
    openPin: () => setPinOpen(true),
    closePin: () => setPinOpen(false),
    tryPin,
    unlock,
    lock,
  };
}
