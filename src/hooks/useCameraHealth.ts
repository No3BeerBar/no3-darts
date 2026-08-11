"use client";

/**
 * Subscribe to Board Manager / camera health from the companion bridge.
 * SSE `camera_health` + lightweight poll of GET /api/camera/health.
 */

import { useEffect, useState } from "react";
import type { CameraHealth } from "@/lib/camera-health";

export type CameraHealthNotice = {
  level: string;
  message: string;
  restarting?: boolean;
  ts: number;
} | null;

export function useCameraHealth(roomId: string | undefined, enabled = true) {
  const [health, setHealth] = useState<CameraHealth | null>(null);
  const [notice, setNotice] = useState<CameraHealthNotice>(null);

  useEffect(() => {
    if (!enabled) return;
    const room = (roomId || "Board 1").trim() || "Board 1";
    let cancelled = false;
    let es: EventSource | null = null;
    let hideTimer: number | null = null;

    const showNotice = (h: CameraHealth) => {
      if (h.level === "ok" && !h.restarting) {
        // Briefly show recovery, then clear
        setNotice({
          level: "ok",
          message: h.message || "Cameras healthy",
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

  return { health, notice };
}
