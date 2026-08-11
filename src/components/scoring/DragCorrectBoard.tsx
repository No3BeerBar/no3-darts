"use client";

import type { SegmentKind } from "@/engine";
import { Dartboard } from "@/components/board/Dartboard";
import { cn } from "@/lib/utils";

interface DragCorrectBoardProps {
  size?: number;
  /** Highlight target number (Baseball wedge / Killer double) */
  focusNumber?: number | null;
  focusRing?: "wedge" | "double";
  onConfirm: (kind: SegmentKind, number: number) => void;
  className?: string;
}

/** Correction board — drag/tap; pin sits exactly under finger. */
export function DragCorrectBoard({
  size = 320,
  focusNumber = null,
  focusRing = "wedge",
  onConfirm,
  className,
}: DragCorrectBoardProps) {
  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <Dartboard
        size={size}
        focusNumber={focusNumber}
        focusRing={focusRing}
        interactive
        showLiveLabel
        onScore={(kind, number) => onConfirm(kind, number)}
      />
      <p className="text-center text-[11px] text-zinc-500">
        Drag · lift to confirm
      </p>
    </div>
  );
}
