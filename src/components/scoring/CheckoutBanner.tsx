"use client";

import type { CheckoutSuggestion } from "@/engine";
import { cn } from "@/lib/utils";

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
        "rounded-xl border border-[rgb(225_6_0/0.4)] bg-[rgb(225_6_0/0.1)] px-4 py-2 text-center",
        className
      )}
    >
      <span className="font-display text-xs tracking-widest text-[var(--brand-red-bright)]">
        Checkout
      </span>
      <div className="font-logo text-xl tracking-wide text-white sm:text-2xl">
        {suggestion.description}
      </div>
    </div>
  );
}
