"use client";

/**
 * While on idle play / setup (not mid-match), log the tablet session out after
 * 2 minutes with no touch/key/scroll activity. Resets on interaction.
 * Does not run during active scoring — thinking time between darts is fine.
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
