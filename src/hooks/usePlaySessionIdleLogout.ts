"use client";

/**
 * Tablet session idle logout (John's rules):
 * 1. Not in a match → sign out after 2 minutes inactivity.
 * 2. Mid-match (playing / paused / leg_won) → stay signed in.
 * 3. After match ends (match_won → idle) → arm the 2-minute timer again.
 *
 * Resets on touch/key/scroll while armed. Runs from AppShell for both setup
 * `/` and bare `/play`.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  PLAY_SESSION_ACTIVITY_EVENTS,
  PLAY_SESSION_IDLE_MS,
  shouldArmPlaySessionIdle,
} from "@/lib/play-session-idle";
import { useGameStore } from "@/store/game-store";
import { useSessionStore } from "@/store/session-store";

export function usePlaySessionIdleLogout() {
  const pathname = usePathname();
  const state = useGameStore((s) => s.state);
  const hydrated = useGameStore((s) => s.hydrated);
  const player = useSessionStore((s) => s.player);
  const tabletPlayers = useSessionStore((s) => s.tabletPlayers);
  const logout = useSessionStore((s) => s.logout);
  const armed = hydrated && shouldArmPlaySessionIdle(pathname, state);
  /** Anyone PIN-trusted on this tablet (session cookie and/or unlock roster). */
  const hasSignedIn = Boolean(player) || tabletPlayers.length > 0;
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    if (!armed || !hasSignedIn) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void logoutRef.current();
      }, PLAY_SESSION_IDLE_MS);
    };

    arm();

    for (const evt of PLAY_SESSION_ACTIVITY_EVENTS) {
      window.addEventListener(evt, arm, { passive: true });
    }

    return () => {
      if (timer) clearTimeout(timer);
      for (const evt of PLAY_SESSION_ACTIVITY_EVENTS) {
        window.removeEventListener(evt, arm);
      }
    };
  }, [armed, hasSignedIn]);
}
