/**
 * Tablet-local roster of PIN-verified players for the current sign-in window.
 *
 * Survives end-game → next-game so setup can show quick re-add chips without
 * opening the full Saved players directory. Cleared on Sign out and on the
 * 2-minute idle logout (not mid-match).
 */

export type TabletSessionPlayer = { id: string; name: string };

const KEY = "no3_tablet_session_players";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function getTabletSessionPlayers(): TabletSessionPlayer[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is TabletSessionPlayer =>
          Boolean(p) &&
          typeof p === "object" &&
          typeof (p as TabletSessionPlayer).id === "string" &&
          typeof (p as TabletSessionPlayer).name === "string"
      )
      .map((p) => ({ id: p.id, name: p.name }));
  } catch {
    return [];
  }
}

export function setTabletSessionPlayers(players: TabletSessionPlayer[]): void {
  if (!canUseStorage()) return;
  try {
    if (players.length === 0) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(players));
  } catch {
    // quota / private mode
  }
}

export function rememberTabletSessionPlayer(player: {
  id: string;
  name: string;
}): TabletSessionPlayer[] {
  const prev = getTabletSessionPlayers();
  const next = [
    { id: player.id, name: player.name },
    ...prev.filter((p) => p.id !== player.id),
  ];
  setTabletSessionPlayers(next);
  return next;
}

export function clearTabletSessionPlayers(): void {
  setTabletSessionPlayers([]);
}

export function isOnTabletSession(
  playerId: string,
  roster: TabletSessionPlayer[] = getTabletSessionPlayers()
): boolean {
  return roster.some((p) => p.id === playerId);
}

/** Cold start: nobody signed in on this tablet — use Saved players picker. */
export function isTabletSessionCold(
  sessionPlayerId: string | null | undefined,
  roster: TabletSessionPlayer[] = getTabletSessionPlayers()
): boolean {
  return !sessionPlayerId && roster.length === 0;
}
