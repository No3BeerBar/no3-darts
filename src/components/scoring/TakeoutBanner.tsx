"use client";

import { segmentLabel, type DartThrow } from "@/engine";
import { cn } from "@/lib/utils";

/**
 * Patron-visible Autodarts takeout / remove-darts / yellow Reset.
 * Bridge pauses camera scoring while this is active; Reset takeout clears so
 * the next visit can start clean (bartender-proof — not a passive banner only).
 *
 * Last visit (player + 3 darts) stays in this banner so a yellow AD reset
 * never looks like a blank /play. Never hide while `active` is true.
 *
 * Mount when shouldShowTakeoutUi (live Autodarts takeout OR server hold).
 * Sandbox / no bridge / stale leftover must never show this.
 */
export function TakeoutBanner({
  active,
  busy,
  youreDone,
  onReady,
  playerName,
  darts,
}: {
  active: boolean;
  busy?: boolean;
  /** Exact-41 / X01 bust — visit already over; wait for green. */
  youreDone?: boolean;
  onReady: () => void;
  playerName?: string | null;
  darts?: DartThrow[];
}) {
  if (!active) return null;

  const slots = [0, 1, 2] as const;
  const showVisit = Boolean(playerName) || (darts && darts.length > 0);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center px-3">
      <div
        className={cn(
          "pointer-events-auto flex max-w-lg flex-col items-center gap-2 rounded-xl border px-4 py-3 text-center shadow-lg backdrop-blur sm:flex-row sm:text-left",
          "border-amber-400/80 bg-amber-950/95 text-amber-50"
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-wide">
            {youreDone
              ? "You're done — removing darts"
              : "Removing darts - takeout"}
          </p>
          {showVisit ? (
            <div className="mt-1.5" data-testid="play-takeout-last-visit">
              {playerName ? (
                <p className="text-xs font-semibold text-amber-50">
                  {playerName}
                  <span className="ml-1 font-normal text-amber-200/80">
                    last visit
                  </span>
                </p>
              ) : null}
              <div className="mt-1 flex items-center justify-center gap-1.5 sm:justify-start">
                {slots.map((i) => {
                  const d = darts?.[i];
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex h-9 w-12 items-center justify-center rounded-md border font-logo text-sm",
                        d
                          ? "border-amber-300/70 bg-amber-900/80 text-amber-50"
                          : "border-dashed border-amber-200/30 text-amber-200/40"
                      )}
                    >
                      {d ? segmentLabel(d.kind, d.number) : "—"}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <p className="mt-1 text-xs text-amber-100/90">
            {youreDone
              ? "Visit over. Pull your darts and wait until the Autodarts board is green. Tap Reset if it stays yellow."
              : "Camera scoring paused. Pull your darts, then tap Reset so the next visit can start. Clears a stuck takeout from /play."}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onReady}
          className={cn(
            "min-h-11 shrink-0 rounded-lg bg-amber-300 px-4 text-sm font-semibold text-amber-950",
            "hover:bg-amber-200 disabled:opacity-60"
          )}
        >
          {busy ? "Resetting…" : "Reset takeout"}
        </button>
      </div>
    </div>
  );
}
