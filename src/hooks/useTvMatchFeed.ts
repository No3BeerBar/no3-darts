"use client";

/**
 * Robust TV match feed: poll + SSE with reconnect + session cache.
 * Exposes `idle` so attract mode can show when no match is running.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@/engine/types";
import {
  isLiveTakeoutSignal,
  type CameraHealth,
} from "@/lib/camera-health";
import {
  MATCH_WON_ATTRACT_MS,
  TV_ACTIVE_POLL_MS,
  idleAfterEmptyActivePoll,
  isLiveTvStatus,
  nextIdleDeadline,
  shouldApplyLiveMatch,
  shouldRefreshLiveSighting,
  shouldStartMatchWonAttractTimer,
} from "@/lib/tv-match-feed";

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

function isLiveStatus(status: GameState["status"] | undefined): boolean {
  return isLiveTvStatus(status);
}

export function useTvMatchFeed(room: string) {
  const [state, setState] = useState<GameState | null>(null);
  const [idle, setIdle] = useState(true);
  const [connected, setConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [statusText, setStatusText] = useState("Connecting…");
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);
  /** Live Autodarts takeout only — drives the prominent TV banner. */
  const [takeoutActive, setTakeoutActive] = useState(false);
  const [takeoutMessage, setTakeoutMessage] = useState<string | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const healthTimer = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);
  const idleDeadline = useRef<number | null>(null);
  const matchWonTimer = useRef<number | null>(null);
  const matchWonForId = useRef<string | null>(null);
  const dismissedWonId = useRef<string | null>(null);
  const lastSeenLiveAt = useRef<number | null>(null);

  const goIdle = useCallback((reason: string) => {
    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    idleDeadline.current = null;
    if (matchWonTimer.current) {
      window.clearTimeout(matchWonTimer.current);
      matchWonTimer.current = null;
    }
    matchWonForId.current = null;
    setState(null);
    saveCache(roomRef.current, null);
    setIdle(true);
    setStatusText(reason);
  }, []);

  const scheduleIdle = useCallback(
    (delayMs: number, reason: string) => {
      const fireAt = Date.now() + Math.max(0, delayMs);
      const next = nextIdleDeadline(idleDeadline.current, fireAt);
      if (next == null) return;
      if (idleDeadline.current != null && next >= idleDeadline.current && idleTimer.current) {
        return;
      }
      idleDeadline.current = next;
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(
        () => goIdle(reason),
        Math.max(0, next - Date.now())
      );
    },
    [goIdle]
  );

  const apply = useCallback(
    (match: GameState | null, source: string) => {
      if (!shouldApplyLiveMatch(match, dismissedWonId.current)) return;
      const roomNow = roomRef.current;
      const matchRoom = (match.roomId || "").trim().toLowerCase();
      const want = roomNow.trim().toLowerCase();
      if (matchRoom && want && matchRoom !== want) {
        if (matchRoom.replace(/\s+/g, " ") !== want.replace(/\s+/g, " ")) {
          return;
        }
      }

      if (
        shouldRefreshLiveSighting({
          status: match.status,
          matchId: match.id,
          lingerMatchId: matchWonForId.current,
        })
      ) {
        if (idleTimer.current) {
          window.clearTimeout(idleTimer.current);
          idleTimer.current = null;
        }
        idleDeadline.current = null;
        lastSeenLiveAt.current = Date.now();
      }
      setIdle(false);

      setState((prev) => {
        if (prev && match.updatedAt < prev.updatedAt) return prev;
        saveCache(roomNow, match);
        return match;
      });
      setLastSyncAt(Date.now());
      setStatusText(source === "cache" ? "Restored (waiting for tablet)" : "Live");

      if (
        shouldStartMatchWonAttractTimer({
          matchStatus: match.status,
          matchId: match.id,
          timerMatchId: matchWonForId.current,
        })
      ) {
        matchWonForId.current = match.id;
        if (matchWonTimer.current) window.clearTimeout(matchWonTimer.current);
        matchWonTimer.current = window.setTimeout(() => {
          dismissedWonId.current = match.id;
          matchWonForId.current = null;
          matchWonTimer.current = null;
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
      } else if (match.status !== "match_won") {
        dismissedWonId.current = null;
        matchWonForId.current = null;
        if (matchWonTimer.current) {
          window.clearTimeout(matchWonTimer.current);
          matchWonTimer.current = null;
        }
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
    let healthPollTimer: number | null = null;
    let sseRetryTimer: number | null = null;
    let sseDelay = 1000;

    const applyCameraHealth = (h: CameraHealth | null) => {
      if (!h) {
        setTakeoutActive(false);
        setTakeoutMessage(null);
        return;
      }
      const want = roomRef.current.trim().toLowerCase();
      const got = (h.roomId || "").trim().toLowerCase();
      if (got && want && got !== want) return;

      // Live Autodarts takeout only — never sticky sandbox / offline spam.
      if (isLiveTakeoutSignal(h)) {
        setTakeoutActive(true);
        setTakeoutMessage(h.message || "Pull darts — takeout");
        // Takeout has its own TV banner; don't also use the small toast.
        setCameraNotice(null);
        if (healthTimer.current) window.clearTimeout(healthTimer.current);
        healthTimer.current = null;
        return;
      }

      setTakeoutActive(false);
      setTakeoutMessage(null);

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
    };

    const fetchCameraHealth = async () => {
      if (stopped) return;
      try {
        const r = await fetch(
          `/api/camera/health?room=${encodeURIComponent(room)}&_=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const data = (await r.json()) as { health?: CameraHealth | null };
        applyCameraHealth(data.health ?? null);
      } catch {
        /* offline */
      }
    };

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
        const incoming = (data.match ?? null) as GameState | null;
        if (shouldApplyLiveMatch(incoming, dismissedWonId.current)) {
          apply(incoming, "poll");
        } else {
          // No active match — remaining grace from last live sighting (do not reset)
          const decision = idleAfterEmptyActivePoll({
            lastSeenLiveAt: lastSeenLiveAt.current,
            now: Date.now(),
          });
          if (decision.goIdle) {
            goIdle(
              lastSeenLiveAt.current ? "Board idle · attract" : "Waiting for match…"
            );
          } else {
            scheduleIdle(decision.delayMs, "Board idle · attract");
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
          };
          if (data.state) apply(data.state, "sse");
        } catch {
          /* */
        }
      });

      es.addEventListener("camera_health", (ev) => {
        try {
          const h = JSON.parse((ev as MessageEvent).data) as CameraHealth;
          applyCameraHealth(h);
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
    void fetchCameraHealth();
    pollTimer = window.setInterval(fetchActive, TV_ACTIVE_POLL_MS);
    healthPollTimer = window.setInterval(fetchCameraHealth, 4000);
    connectSse();

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void fetchActive();
        void fetchCameraHealth();
      }
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
      if (healthPollTimer) window.clearInterval(healthPollTimer);
      if (sseRetryTimer) window.clearTimeout(sseRetryTimer);
      if (healthTimer.current) window.clearTimeout(healthTimer.current);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      if (matchWonTimer.current) window.clearTimeout(matchWonTimer.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", fetchActive);
    };
  }, [room, apply, goIdle, scheduleIdle]);

  return {
    state,
    setState,
    idle,
    connected,
    lastSyncAt,
    statusText,
    cameraNotice,
    takeoutActive,
    takeoutMessage,
    apply,
  };
}
