"use client";

/**
 * Subscribe to Board Manager / camera health from the companion bridge.
 * SSE `camera_health` + lightweight poll of GET /api/camera/health.
 *
 * Takeout / Pull-darts UI only follows a *live* Autodarts takeout signal.
 * Sandbox (no bridge), AD offline, and stale leftover health must not
 * sticky-loop "Ready for next visit" or Removing-darts.
 */

import { useCallback, useEffect, useState } from "react";
import {
  isCameraBridgeOffline,
  shouldShowTakeoutUi,
  type CameraHealth,
} from "@/lib/camera-health";

export type CameraHealthNotice = {
  level: string;
  message: string;
  restarting?: boolean;
  takeout?: boolean;
  ts: number;
} | null;

export function useCameraHealth(roomId: string | undefined, enabled = true) {
  const [health, setHealth] = useState<CameraHealth | null>(null);
  const [notice, setNotice] = useState<CameraHealthNotice>(null);
  const [takeout, setTakeout] = useState(false);
  const [takeoutBusy, setTakeoutBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const room = (roomId || "Board 1").trim() || "Board 1";
    let cancelled = false;
    let es: EventSource | null = null;
    let hideTimer: number | null = null;
    /** Edge-trigger ok/recovery toasts so sticky takeout_cleared cannot spam. */
    let lastOkToastTs: number | null = null;

    const showNotice = (h: CameraHealth) => {
      // Live Autodarts takeout OR server next-seat hold (silent hold after
      // undo/correct while AD sits in yellow reset with takeout:false).
      if (shouldShowTakeoutUi(h)) {
        setTakeout(true);
        setNotice({
          level: "takeout",
          message: h.message || "Pull darts — takeout",
          takeout: true,
          ts: h.ts,
        });
        if (hideTimer) window.clearTimeout(hideTimer);
        hideTimer = null;
        return;
      }

      setTakeout(false);

      // Offline / unreachable AD: drop takeout UI; do not toast Ready loop.
      if (isCameraBridgeOffline(h)) {
        if (h.level === "ok" && !h.restarting) {
          setNotice(null);
          return;
        }
        setNotice({
          level: h.level,
          message:
            h.restarting
              ? "Detection restarting…"
              : h.message || "Cameras unhealthy",
          restarting: h.restarting,
          ts: h.ts,
        });
        if (hideTimer) window.clearTimeout(hideTimer);
        hideTimer = null;
        return;
      }

      if (h.level === "ok" && !h.restarting) {
        // Briefly show recovery, then clear (skip empty "Cameras healthy" noise
        // when clearing takeout — still show between-games reset).
        const msg = h.message || "Cameras healthy";
        const show =
          h.reason === "between_games_recal" ||
          h.reason === "takeout_cleared" ||
          msg.toLowerCase().includes("reset") ||
          msg.toLowerCase().includes("ready");
        if (!show && msg === "Cameras healthy") {
          setNotice(null);
          return;
        }
        if (!show) {
          setNotice(null);
          return;
        }
        // Same health event polled every few seconds must not re-toast.
        if (lastOkToastTs === h.ts) {
          return;
        }
        lastOkToastTs = h.ts;
        setNotice({
          level: "ok",
          message: msg,
          ts: h.ts,
        });
        if (hideTimer) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          if (!cancelled) setNotice(null);
        }, 1800);
        return;
      }
      setNotice({
        level: h.level,
        message:
          h.restarting
            ? "Detection restarting…"
            : h.message || "Cameras unhealthy",
        restarting: h.restarting,
        ts: h.ts,
      });
      if (hideTimer) window.clearTimeout(hideTimer);
      // Keep unhealthy banner until cleared by ok
      hideTimer = null;
    };

    const apply = (h: CameraHealth | null) => {
      if (!h) {
        setHealth(null);
        setTakeout(false);
        return;
      }
      const want = room.toLowerCase();
      const got = (h.roomId || "").trim().toLowerCase();
      if (got && want && got !== want) return;
      setHealth(h);
      showNotice(h);
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const r = await fetch(
          `/api/camera/health?room=${encodeURIComponent(room)}&_=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const data = (await r.json()) as { health?: CameraHealth | null };
        if (data.health) apply(data.health);
        else apply(null);
      } catch {
        /* offline */
      }
    };

    const connectSse = () => {
      try {
        es?.close();
      } catch {
        /* */
      }
      try {
        es = new EventSource(`/api/camera/stream?_=${Date.now()}`);
        es.addEventListener("camera_health", (ev) => {
          try {
            const h = JSON.parse((ev as MessageEvent).data) as CameraHealth;
            apply(h);
          } catch {
            /* */
          }
        });
        es.onerror = () => {
          try {
            es?.close();
          } catch {
            /* */
          }
          es = null;
          if (!cancelled) window.setTimeout(connectSse, 2500);
        };
      } catch {
        if (!cancelled) window.setTimeout(connectSse, 3000);
      }
    };

    void poll();
    const pollId = window.setInterval(poll, 4000);
    connectSse();

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      if (hideTimer) window.clearTimeout(hideTimer);
      try {
        es?.close();
      } catch {
        /* */
      }
    };
  }, [enabled, roomId]);

  const acknowledgeTakeout = useCallback(async () => {
    const room = (roomId || "Board 1").trim() || "Board 1";
    setTakeoutBusy(true);
    // Optimistic clear so stuck Removing-darts is never trapped behind a
    // slow/failed bridge poll; server still owns hold + takeout_cleared.
    setTakeout(false);
    setNotice({
      level: "ok",
      message: "Ready for next visit",
      ts: Date.now(),
    });
    window.setTimeout(() => {
      setNotice((n) => (n?.message === "Ready for next visit" ? null : n));
    }, 1800);
    try {
      await fetch("/api/camera/takeout-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room }),
      });
      // Companion starts detection if Stopped, clears takeout if yellow;
      // no-op if already detecting. Never ends a live visit / mid-match recal.
    } catch {
      /* offline - local banner already cleared; retry via poll if health sticks */
    } finally {
      window.setTimeout(() => setTakeoutBusy(false), 800);
    }
  }, [roomId]);

  const armTakeoutUi = useCallback(() => {
    // Immediate Reset after tablet Fix ends a visit — do not wait for the
    // 4s health poll while Autodarts is already in yellow takeout.
    setTakeout(true);
    setNotice({
      level: "takeout",
      message: "Pull darts — takeout",
      takeout: true,
      ts: Date.now(),
    });
  }, []);

  return { health, notice, takeout, takeoutBusy, acknowledgeTakeout, armTakeoutUi };
}
