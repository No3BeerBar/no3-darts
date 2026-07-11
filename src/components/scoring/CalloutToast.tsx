"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function CalloutToast({ message }: { message: string | null }) {
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    setText(message);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1600);
    return () => clearTimeout(t);
  }, [message]);

  if (!text) return null;

  const big =
    text.includes("180") ||
    text.includes("GAME") ||
    text.includes("SHANGHAI") ||
    text.includes("CHECKOUT") ||
    text.includes("BUST");

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-24 z-50 flex justify-center transition-all duration-300",
        visible ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
      )}
    >
      <div
        className={cn(
          "rounded-2xl border-2 px-8 py-4 shadow-2xl backdrop-blur-md",
          big
            ? "border-[var(--brand-red)] bg-black/90 text-[var(--brand-red-bright)]"
            : "border-zinc-600 bg-zinc-900/90 text-zinc-100"
        )}
      >
        <span className={cn("font-black tracking-wide", big ? "text-4xl sm:text-5xl" : "text-2xl")}>
          {text}
        </span>
      </div>
    </div>
  );
}
