"use client";

import { cn } from "@/lib/utils";

interface PinPadProps {
  value: string;
  onChange: (pin: string) => void;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
}

/** Tablet-friendly 4-digit PIN pad */
export function PinPad({
  value,
  onChange,
  maxLength = 4,
  disabled = false,
  className,
}: PinPadProps) {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "C"] as const;

  const press = (k: (typeof keys)[number]) => {
    if (disabled) return;
    if (k === "C") {
      onChange("");
      return;
    }
    if (k === "⌫") {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= maxLength) return;
    onChange(value + String(k));
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex justify-center gap-3" aria-label="PIN digits">
        {Array.from({ length: maxLength }, (_, i) => (
          <div
            key={i}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl border text-2xl font-bold",
              value.length > i
                ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.15)] text-[var(--brand-red-bright)]"
                : "border-zinc-700 bg-zinc-900 text-zinc-600"
            )}
          >
            {value.length > i ? "•" : ""}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) => (
          <button
            key={String(k)}
            type="button"
            disabled={disabled}
            onClick={() => press(k)}
            className={cn(
              "h-14 rounded-xl text-xl font-bold transition active:scale-95 disabled:opacity-40",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]",
              typeof k === "number"
                ? "border border-zinc-600 bg-zinc-800 text-zinc-50 hover:bg-zinc-700"
                : "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
            )}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
