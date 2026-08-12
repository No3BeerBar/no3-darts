"use client";

import { cn } from "@/lib/utils";

/**
 * Patron-visible Autodarts takeout / remove-darts state.
 * Bridge pauses camera scoring while this is active; Ready resets so the
 * next visit can start clean (not a passive banner only).
 */
export function TakeoutBanner({
  active,
  busy,
  onReady,
}: {
  active: boolean;
  busy?: boolean;
  onReady: () => void;
}) {
  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center px-3">
      <div
        className={cn(
          "pointer-events-auto flex max-w-lg flex-col items-center gap-2 rounded-xl border px-4 py-3 text-center shadow-lg backdrop-blur sm:flex-row sm:text-left",
          "border-sky-500/45 bg-sky-950/95 text-sky-50"
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-wide">
            Removing darts — takeout
          </p>
          <p className="text-xs text-sky-200/90">
            Camera scoring paused. Pull your darts, then tap Reset so the next
            visit can start.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onReady}
          className={cn(
            "min-h-11 shrink-0 rounded-lg bg-sky-400 px-4 text-sm font-semibold text-sky-950",
            "hover:bg-sky-300 disabled:opacity-60"
          )}
        >
          {busy ? "Resetting…" : "Reset takeout"}
        </button>
      </div>
    </div>
  );
}
