"use client";

import { cn } from "@/lib/utils";

interface NumberPadProps {
  onNumber: (n: number) => void;
  onClear: () => void;
  onSubmit: () => void;
  value: string;
  className?: string;
}

/** Big TV-friendly number pad for quick total entry (optional) + digits */
export function NumberPad({ onNumber, onClear, onSubmit, value, className }: NumberPadProps) {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, "C", 0, "OK"] as const;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="min-h-[3.25rem] rounded-xl border border-[rgb(225_6_0/0.3)] bg-[#121212] px-4 py-3 text-center font-mono text-3xl font-bold tracking-wider text-[var(--brand-red-bright)]">
        {value || "—"}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) => {
          const isAction = k === "C" || k === "OK";
          return (
            <button
              key={String(k)}
              type="button"
              onClick={() => {
                if (k === "C") onClear();
                else if (k === "OK") onSubmit();
                else onNumber(k);
              }}
              className={cn(
                "h-14 rounded-xl text-xl font-bold transition active:scale-95",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]",
                k === "OK" && "bg-[var(--brand-red)] text-white hover:bg-[var(--brand-red-bright)]",
                k === "C" && "bg-zinc-700 text-zinc-100 hover:bg-zinc-600",
                !isAction && "border border-zinc-600 bg-zinc-800 text-zinc-50 hover:bg-zinc-700"
              )}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}
