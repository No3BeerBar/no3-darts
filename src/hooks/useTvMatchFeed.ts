"use client";

/**
 * Robust TV match feed: poll + SSE with reconnect + session cache.
 * Survives server restarts (once the tablet heartbeats again).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@/engine/types";

const CACHE_KEY = "no3_tv_match_cache";

function cacheKey(room: string) {
  return `${CACHE_KEY}:${room}`;
}

function loadCache(room: string): GameState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(room));
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

function saveCache(room: string, state: GameState | null) {
  if (typeof window === "undefined") return;
  try {
    if (!state) {
      sessionStorage.removeItem(cacheKey(room));
      return;
    }
    sessionStorage.setItem(cacheKey(room), JSON.stringify(state));
  } catch {
    /* quota */
  }
}

export function useTvMatchFeed(room: string) {
  const [state, setState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [statusText, setStatusText] = useState("Connecting…");
  const [callout, setCallout] = useState<string | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const calloutTimer = useRef<number | null>(null);

  const flashCallout = useCallback((text?: string) => {
    if (!text) return;
    setCallout(text);
    if (calloutTimer.current) window.clearTimeout(calloutTimer.current);
    calloutTimer.current = window.setTimeout(() => setCallout(null), 2200);
  }, []);

  const apply = useCallback((match: GameState | null, source: string) => {
    if (!match) return;
    const roomNow = roomRef.current;
    // Accept match if same room, or no room on match, or only live match
    const matchRoom = (match.roomId || "").trim().toLowerCase();
    const want = roomNow.trim().toLowerCase();
    if (matchRoom && want && matchRoom !== want) {
      // still allow if rooms loosely equal after normalize
      if (matchRoom.replace(/\s+/g, " ") !== want.replace(/\s+/g, " ")) {
        return;
      }
    }

    setState((prev) => {
      if (prev && match.updatedAt < prev.updatedAt) return prev;
      saveCache(roomNow, match);
      return match;
    });
    setLastSyncAt(Date.now());
    setStatusText(source === "cache" ? "Restored (waiting for tablet)" : "Live");
  }, []);

  useEffect(() => {
    if (!room) return;

    // Seed from session cache immediately (survives TV page refresh)
    const cached = loadCache(room);
    if (cached) {
      apply(cached, "cache");
      setStatusText("Restored cache · reconnecting…");
    } else {
      setState(null);
      setStatusText("Waiting for match…");
    }

    let stopped = false;
    let es: EventSource | null = null;
    let pollTimer: number | null = null;
    let sseRetryTimer: number | null = null;
    let sseDelay = 1000;

    const fetchActive = async () => {
      if (stopped) return;
      try {
        const r = await fetch(
          `/api/matches/active?room=${encodeURIComponent(room)}&_=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!r.ok) {
          setConnected(false);
          setStatusText(`Server ${r.status} · retrying…`);
          return;
        }
        const data = await r.json();
        setConnected(true);
        if (data.match) {
          apply(data.match as GameState, "poll");
        } else {
          // Don't clear existing state — tablet may re-publish after deploy
          setStatusText((prev) =>
            prev.startsWith("Live") || prev.includes("Restored")
              ? "Waiting for tablet sync…"
              : "Waiting for match…"
          );
        }
      } catch {
        setConnected(false);
        setStatusText("Offline · retrying…");
      }
    };

    const connectSse = () => {
      if (stopped) return;
      try {
        es?.close();
      } catch {
        /* */
      }
      try {
        es = new EventSource(`/api/camera/stream?_=${Date.now()}`);
      } catch {
        scheduleSseRetry();
        return;
      }

      es.addEventListener("connected", () => {
        setConnected(true);
        sseDelay = 1000;
        void fetchActive();
      });

      es.addEventListener("match_update", (ev) => {
        try {
          const m = JSON.parse((ev as MessageEvent).data) as GameState;
          apply(m, "sse");
        } catch {
          /* */
        }
      });

      es.addEventListener("dart_detected", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            state?: GameState;
            callout?: string;
          };
          if (data.state) apply(data.state, "sse");
          if (data.callout) flashCallout(data.callout);
        } catch {
          /* */
        }
      });

      es.onerror = () => {
        setConnected(false);
        setStatusText("Stream lost · reconnecting…");
        try {
          es?.close();
        } catch {
          /* */
        }
        es = null;
        scheduleSseRetry();
      };
    };

    const scheduleSseRetry = () => {
      if (stopped) return;
      if (sseRetryTimer) window.clearTimeout(sseRetryTimer);
      sseRetryTimer = window.setTimeout(() => {
        connectSse();
        sseDelay = Math.min(sseDelay * 1.5, 15000);
      }, sseDelay);
    };

    void fetchActive();
    pollTimer = window.setInterval(fetchActive, 1500);
    connectSse();

    const onVis = () => {
      if (document.visibilityState === "visible") void fetchActive();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", fetchActive);

    return () => {
      stopped = true;
      try {
        es?.close();
      } catch {
        /* */
      }
      if (pollTimer) window.clearInterval(pollTimer);
      if (sseRetryTimer) window.clearTimeout(sseRetryTimer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", fetchActive);
    };
  }, [room, apply, flashCallout]);

  return { state, setState, connected, lastSyncAt, statusText, callout, apply };
}
