"use client";

import type { LaneOverview as LaneOverviewType } from "@/lib/tournament";
import { cn } from "@/lib/utils";

export function LaneOverviewPanel({
  lanes,
  compact,
}: {
  lanes: LaneOverviewType[];
  compact?: boolean;
}) {
  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3")}>
      {lanes.map((slot) => (
        <div
          key={slot.lane}
          className={cn(
            "rounded-lg border px-3 py-3",
            slot.match
              ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.1)]"
              : "border-[var(--panel-border)] bg-[var(--panel)]"
          )}
        >
          <div className="font-display text-xs tracking-widest text-zinc-500">{slot.lane}</div>
          {slot.match ? (
            <>
              <div className="mt-1 truncate font-display text-sm text-white">
                {slot.playerAName} vs {slot.playerBName}
              </div>
              <div className="mt-0.5 truncate text-xs text-zinc-500">
                {slot.tournamentName} · {slot.match.roundName} ·{" "}
                {slot.match.status.replace("_", " ")}
              </div>
            </>
          ) : (
            <div className="mt-1 font-display text-sm text-zinc-600">Free</div>
          )}
        </div>
      ))}
    </div>
  );
}
