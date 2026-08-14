"use client";

import { segmentLabel, type DartThrow } from "@/engine";
import { cn } from "@/lib/utils";

/**
 * Prominent TV takeout / removing-darts status — banner, not a full-screen
 * takeover. Last visit (player + 3 darts) stays visible underneath and is
 * also echoed here so the score is unmissable from across the bar.
 *
 * Only mount for a *live* Autodarts takeout signal (see isLiveTakeoutSignal).
 * Sandbox / no bridge must never show this.
 */
export function TvTakeoutBanner({
  active,
  message,
  playerName,
  darts,
  turnTotal,
}: {
  active: boolean;
  /** Optional bridge message; defaults to Pull darts copy. */
  message?: string | null;
  playerName?: string | null;
  darts?: DartThrow[];
  turnTotal?: number | null;
}) {
  if (!active) return null;

  const slots = [0, 1, 2] as const;
  const showVisit = Boolean(playerName) || (darts && darts.length > 0);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-3 pt-3 sm:px-6 sm:pt-4"
      data-testid="tv-takeout-banner"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "w-full max-w-5xl overflow-hidden rounded-2xl border-2 px-5 py-3 text-center shadow-2xl backdrop-blur-md sm:px-8 sm:py-4",
          "border-amber-400/80 bg-amber-950/95 text-amber-50",
          "animate-pulse"
        )}
      >
        <p className="font-display text-xs tracking-[0.35em] text-amber-200/90 sm:text-sm">
          AUTODARTS · TAKEOUT
        </p>
        <p className="font-logo mt-1 text-3xl leading-none text-amber-50 sm:text-5xl lg:text-6xl">
          Removing darts
        </p>
        {showVisit ? (
          <div
            className="mt-3"
            data-testid="tv-takeout-last-visit"
          >
            {playerName ? (
              <p className="font-display text-base font-bold tracking-wide text-amber-50 sm:text-xl">
                {playerName}
                <span className="ml-2 font-normal text-amber-200/80">last visit</span>
              </p>
            ) : null}
            <div className="mt-2 flex items-center justify-center gap-2 sm:gap-3">
              {slots.map((i) => {
                const d = darts?.[i];
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex h-12 w-16 flex-col items-center justify-center rounded-lg border font-logo text-lg sm:h-14 sm:w-20 sm:text-2xl",
                      d
                        ? "border-amber-300/70 bg-amber-900/80 text-amber-50"
                        : "border-dashed border-amber-200/30 text-amber-200/40"
                    )}
                  >
                    {d ? segmentLabel(d.kind, d.number) : "—"}
                  </div>
                );
              })}
              {typeof turnTotal === "number" ? (
                <div className="ml-1 text-left">
                  <div className="font-display text-[10px] tracking-widest text-amber-200/70">
                    TURN
                  </div>
                  <div className="font-logo text-3xl tabular-nums text-amber-50 sm:text-4xl">
                    {turnTotal}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="mt-2 font-display text-sm font-semibold tracking-wide text-amber-100 sm:text-lg">
          Pull your darts — then tap{" "}
          <span className="rounded bg-amber-300 px-2 py-0.5 font-bold text-amber-950">
            Reset
          </span>{" "}
          on the scoring tablet
        </p>
        {message ? (
          <p className="mt-1 font-display text-sm tracking-wider text-amber-200/80 sm:text-base">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
