"use client";

import type { CheckoutSuggestion } from "@/engine";
import { cn } from "@/lib/utils";

/** Prominent X01 / practice outshot path for the current thrower (iPad-readable). */
export function CheckoutBanner({
  suggestion,
  className,
}: {
  suggestion: CheckoutSuggestion | null;
  className?: string;
}) {
  if (!suggestion) return null;
  return (
    <div
      className={cn(
        "rounded-xl border border-[rgb(225_6_0/0.5)] bg-[#0a0a0a] px-3 py-2 text-center",
        className
      )}
      aria-live="polite"
    >
      <div className="font-display text-[10px] tracking-[0.2em] text-[var(--brand-red-bright)]">
        OUTSHOT · {suggestion.remaining}
      </div>
      <div className="mt-0.5 font-logo text-xl tracking-wide text-white sm:text-2xl">
        {suggestion.description}
      </div>
    </div>
  );
}
