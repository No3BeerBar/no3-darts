"use client";

import { cn } from "@/lib/utils";

/**
 * Full-bleed TV takeout / removing-darts status.
 * Watched from across the bar — must be impossible to miss when Autodarts
 * is in takeout or Reset is needed on the scoring tablet.
 *
 * Only mount for a *live* Autodarts takeout signal (see isLiveTakeoutSignal).
 * Sandbox / no bridge must never show this.
 */
export function TvTakeoutBanner({
  active,
  message,
}: {
  active: boolean;
  /** Optional bridge message; defaults to Pull darts copy. */
  message?: string | null;
}) {
  if (!active) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-3 pt-3 sm:px-6 sm:pt-5"
      data-testid="tv-takeout-banner"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "w-full max-w-5xl overflow-hidden rounded-2xl border-2 px-6 py-5 text-center shadow-2xl backdrop-blur-md sm:px-10 sm:py-7",
          "border-amber-400/80 bg-amber-950/95 text-amber-50",
          "animate-pulse"
        )}
      >
        <p className="font-display text-xs tracking-[0.35em] text-amber-200/90 sm:text-sm">
          AUTODARTS · TAKEOUT
        </p>
        <p className="font-logo mt-2 text-4xl leading-none text-amber-50 sm:text-5xl lg:text-6xl">
          Removing darts
        </p>
        <p className="mt-3 font-display text-base font-semibold tracking-wide text-amber-100 sm:text-xl lg:text-2xl">
          Pull your darts — then tap{" "}
          <span className="rounded bg-amber-300 px-2 py-0.5 font-bold text-amber-950">
            Reset
          </span>{" "}
          on the scoring tablet
        </p>
        {message ? (
          <p className="mt-2 font-display text-sm tracking-wider text-amber-200/80 sm:text-base">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
