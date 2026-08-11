import { hasRegisteredPlayers } from "@/lib/match-export";
import type { StoredMatch } from "@/lib/storage";

/**
 * Push finished match to server for registered (PIN) players only.
 * Guest-only matches are never sent — no Postgres history / leaderboard credit.
 * No-ops quietly when DB is down.
 */
export async function persistMatchToServer(match: StoredMatch): Promise<void> {
  if (!hasRegisteredPlayers(match)) return;
  try {
    await fetch("/api/matches/persist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(match),
    });
  } catch {
    // offline / network — localStorage still has the match (if any registered players)
  }
}
