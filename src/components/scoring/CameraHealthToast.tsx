"use client";

import { cn } from "@/lib/utils";
import type { CameraHealthNotice } from "@/hooks/useCameraHealth";

/** Persistent banner for camera / detection health (iPad + TV). */
export function CameraHealthToast({ notice }: { notice: CameraHealthNotice }) {
  if (!notice || notice.level === "ok") {
    // Recovery flash handled briefly by parent clearing notice
    if (!notice) return null;
  }

  const unhealthy =
    notice.level === "unhealthy" ||
    notice.restarting ||
    notice.level === "degraded";

  if (!unhealthy && notice.level === "ok") {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center px-3">
        <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/90 px-4 py-2 text-sm font-medium text-emerald-100 shadow-lg backdrop-blur">
          {notice.message}
        </div>
      </div>
    );
  }

  if (!unhealthy) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center px-3">
      <div
        className={cn(
          "rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-lg backdrop-blur",
          notice.restarting || notice.level === "unhealthy"
            ? "border-amber-500/50 bg-amber-950/95 text-amber-100"
            : "border-[var(--panel-border)] bg-[var(--panel)] text-zinc-100"
        )}
      >
        {notice.restarting
          ? "Detection restarting…"
          : notice.message || "Cameras unhealthy"}
      </div>
    </div>
  );
}
