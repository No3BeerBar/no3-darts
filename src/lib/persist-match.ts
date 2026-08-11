import type { StoredMatch } from "@/lib/storage";

/** Push finished match to server; no-ops quietly when DB is down. */
export async function persistMatchToServer(match: StoredMatch): Promise<void> {
  try {
    await fetch("/api/matches/persist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(match),
    });
  } catch {
    // offline / network — localStorage still has the match
  }
}
