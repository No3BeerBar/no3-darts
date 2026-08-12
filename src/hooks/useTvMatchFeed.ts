"use client";

/**
 * Robust TV match feed: poll + SSE with reconnect + session cache.
 * Exposes `idle` so attract mode can show when no match is running.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@/engine/types";

const CACHE_KEY = "no3_tv_match_cache";
/** Clear live UI after this many ms with no active match on the server. */
const IDLE_GRACE_MS = 8_000;
/** After match_won, linger then return to attract if still won / gone. */
const MATCH_WON_ATTRACT_MS = 20_000;

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

function isLiveStatus(status: GameState["status"] | undefined): boolean {
  return (
    status === "playing" ||
    status === "paused" ||
    status === "leg_won" ||
    status === "match_won"
  );
}

export function useTvMatchFeed(room: string) {
  const [state, setState] = useState<GameState | null>(null);
  const [idle, setIdle] = useState(true);
  const [connected, setConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [statusText, setStatusText] = useState("Connecting…");
  const [callout, setCallout] = useState<string | null>(null);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const calloutTimer = useRef<number | null>(null);
  const healthTimer = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);
  const matchWonTimer = useRef<number | null>(null);
  const lastSeenLiveAt = useRef<number | null>(null);

  const flashCallout = useCallback((text?: string) => {
    if (!text) return;
    setCallout(text);
    if (calloutTimer.current) window.clearTimeout(calloutTimer.current);
    calloutTimer.current = window.setTimeout(() => setCallout(null), 2200);
  }, []);

  const goIdle = useCallback((reason: string) => {
    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (matchWonTimer.current) {
      window.clearTimeout(matchWonTimer.current);
      matchWonTimer.current = null;
    }
    setState(null);
    saveCache(roomRef.current, null);
    setIdle(true);
    setStatusText(reason);
  }, []);

  const scheduleIdle = useCallback(
    (delayMs: number, reason: string) => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => goIdle(reason), delayMs);
    },
    [goIdle]
  );

  const apply = useCallback(
    (match: GameState | null, source: string) => {
      if (!match || !isLiveStatus(match.status)) return;
      const roomNow = roomRef.current;
      const matchRoom = (match.roomId || "").trim().toLowerCase();
      const want = roomNow.trim().toLowerCase();
      if (matchRoom && want && matchRoom !== want) {
        if (matchRoom.replace(/\s+/g, " ") !== want.replace(/\s+/g, " ")) {
          return;
        }
      }

      if (idleTimer.current) {
        window.clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }

      lastSeenLiveAt.current = Date.now();
      setIdle(false);

      setState((prev) => {
        if (prev && match.updatedAt < prev.updatedAt) return prev;
        saveCache(roomNow, match);
        return match;
      });
      setLastSyncAt(Date.now());
      setStatusText(source === "cache" ? "Restored (waiting for tablet)" : "Live");

      if (match.status === "match_won") {
        if (matchWonTimer.current) window.clearTimeout(matchWonTimer.current);
        matchWonTimer.current = window.setTimeout(() => {
          // Still showing a finished match with no newer live state → attract
          setState((cur) => {
            if (cur && cur.id === match.id && cur.status === "match_won") {
              saveCache(roomRef.current, null);
              setIdle(true);
              setStatusText("Match over · attract");
              return null;
            }
            return cur;
          });
        }, MATCH_WON_ATTRACT_MS);
      } else if (matchWonTimer.current) {
        window.clearTimeout(matchWonTimer.current);
        matchWonTimer.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (!room) return;

    const cached = loadCache(room);
    if (cached && isLiveStatus(cached.status)) {
      apply(cached, "cache");
      setStatusText("Restored cache · reconnecting…");
      setIdle(false);
    } else {
      setState(null);
      setIdle(true);
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
        if (data.match && isLiveStatus((data.match as GameState).status)) {
          apply(data.match as GameState, "poll");
        } else {
          // No active match — grace period so brief tablet gaps don't flash attract
          const seen = lastSeenLiveAt.current;
          if (!seen) {
            goIdle("Waiting for match…");
          } else {
            scheduleIdle(IDLE_GRACE_MS, "Board idle · attract");
            setStatusText((prev) =>
              prev.startsWith("Live") || prev.includes("Restored")
                ? "Waiting for tablet sync…"
                : "Waiting for match…"
            );
          }
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

      es.addEventListener("match_removed", () => {
        scheduleIdle(1_500, "Match cleared · attract");
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

      es.addEventListener("camera_health", (ev) => {
        try {
          const h = JSON.parse((ev as MessageEvent).data) as {
            roomId?: string;
            level?: string;
            message?: string;
            restarting?: boolean;
            takeout?: boolean;
            reason?: string;
          };
          const want = roomRef.current.trim().toLowerCase();
          const got = (h.roomId || "").trim().toLowerCase();
          if (got && want && got !== want) return;
          const takeout =
            Boolean(h.takeout) ||
            h.level === "takeout" ||
            h.reason === "takeout";
          if (takeout) {
            setCameraNotice(h.message || "Pull darts — takeout");
            if (healthTimer.current) window.clearTimeout(healthTimer.current);
            healthTimer.current = null;
            return;
          }
          if (h.level === "ok" && !h.restarting) {
            setCameraNotice(null);
            return;
          }
          const text = h.restarting
            ? "Detection restarting…"
            : h.message || "Cameras unhealthy";
          setCameraNotice(text);
          if (healthTimer.current) window.clearTimeout(healthTimer.current);
          if (h.level === "degraded") {
            healthTimer.current = window.setTimeout(
              () => setCameraNotice(null),
              4000
            );
          }
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
      if (healthTimer.current) window.clearTimeout(healthTimer.current);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      if (matchWonTimer.current) window.clearTimeout(matchWonTimer.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", fetchActive);
    };
  }, [room, apply, flashCallout, goIdle, scheduleIdle]);

  return {
    state,
    setState,
    idle,
    connected,
    lastSyncAt,
    statusText,
    callout,
    cameraNotice,
    apply,
  };
}
