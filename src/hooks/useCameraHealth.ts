"use client";

/**
 * Subscribe to Board Manager / camera health from the companion bridge.
 * SSE `camera_health` + lightweight poll of GET /api/camera/health.
 */

import { useCallback, useEffect, useState } from "react";
import type { CameraHealth } from "@/lib/camera-health";

export type CameraHealthNotice = {
  level: string;
  message: string;
  restarting?: boolean;
  takeout?: boolean;
  ts: number;
} | null;

function isTakeoutHealth(h: CameraHealth): boolean {
  return Boolean(
    h.takeout || h.level === "takeout" || h.reason === "takeout"
  );
}

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

    const showNotice = (h: CameraHealth) => {
      if (isTakeoutHealth(h)) {
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
      if (!h) return;
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
      // Bridge ends incomplete visit, probes AD reset, unlocks when board clear.
    } catch {
      /* offline - local banner already cleared; retry via poll if health sticks */
    } finally {
      window.setTimeout(() => setTakeoutBusy(false), 800);
    }
  }, [roomId]);

  return { health, notice, takeout, takeoutBusy, acknowledgeTakeout };
}
