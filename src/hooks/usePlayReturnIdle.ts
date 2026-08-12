"use client";

/**
 * On secondary screens opened from the play kiosk flow (`?from=play`),
 * return to setup/scoring after a short idle period.
 *
 * Does not run on `/` or `/play` themselves — only after navigating away
 * (e.g. to leaderboard). Any pointer/key/scroll activity resets the timer.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PLAY_SECONDARY_IDLE_MS, type PlayBackHref } from "@/lib/play-kiosk";

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "pointerdown",
  "touchstart",
  "keydown",
  "scroll",
  "wheel",
];

export function usePlayReturnIdle(enabled: boolean, back: PlayBackHref) {
  const router = useRouter();
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const goBack = () => {
      router.replace(backRef.current);
    };

    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(goBack, PLAY_SECONDARY_IDLE_MS);
    };

    arm();

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, arm, { passive: true });
    }

    return () => {
      if (timer) clearTimeout(timer);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, arm);
      }
    };
  }, [enabled, router]);
}
