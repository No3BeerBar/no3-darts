/**
 * Client-side persistence via localStorage.
 * Server API can mirror to Postgres when DATABASE_URL is set (see api routes).
 */

import type { GameState } from "@/engine/types";

const KEYS = {
  players: "no3_players",
  matches: "no3_matches",
  activeGame: "no3_active_game",
  settings: "no3_settings",
  rooms: "no3_rooms",
} as const;

export interface StoredPlayer {
  id: string;
  name: string;
  isGuest: boolean;
  createdAt: number;
  stats: PlayerAggregateStats;
}

export interface PlayerAggregateStats {
  matchesPlayed: number;
  matchesWon: number;
  legsWon: number;
  dartsThrown: number;
  totalScore: number;
  oneEighties: number;
  checkoutsHit: number;
  checkoutAttempts: number;
  highestCheckout: number;
  bestThreeDartAvg: number;
}

export interface StoredMatch {
  id: string;
  finishedAt: number;
  mode: string;
  modeLabel: string;
  players: Array<{ id: string; name: string }>;
  winnerId: string | null;
  winnerName: string | null;
  state: GameState;
  summary: {
    legs: number;
    sets: number;
    playerStats: Array<{
      playerId: string;
      name: string;
      avg: number;
      oneEighties: number;
      checkouts: number;
      highestCheckout: number;
    }>;
  };
}

export interface AppSettings {
  barName: string;
  accentColor: string;
  soundEnabled: boolean;
  voiceEnabled: boolean;
  kioskMode: boolean;
  roomName: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  barName: "No.3 Craft Beer Bar",
  accentColor: "#e10600",
  soundEnabled: true,
  voiceEnabled: false,
  kioskMode: false,
  roomName: "Board 1",
};

function emptyStats(): PlayerAggregateStats {
  return {
    matchesPlayed: 0,
    matchesWon: 0,
    legsWon: 0,
    dartsThrown: 0,
    totalScore: 0,
    oneEighties: 0,
    checkoutsHit: 0,
    checkoutAttempts: 0,
    highestCheckout: 0,
    bestThreeDartAvg: 0,
  };
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function read<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode
  }
}

export function getPlayers(): StoredPlayer[] {
  return read<StoredPlayer[]>(KEYS.players, []);
}

export function savePlayers(players: StoredPlayer[]): void {
  write(KEYS.players, players);
}

export function upsertPlayer(player: Omit<StoredPlayer, "stats" | "createdAt"> & Partial<StoredPlayer>): StoredPlayer {
  const players = getPlayers();
  const existing = players.find((p) => p.id === player.id);
  if (existing) {
    Object.assign(existing, player);
    savePlayers(players);
    return existing;
  }
  const created: StoredPlayer = {
    id: player.id,
    name: player.name,
    isGuest: player.isGuest ?? false,
    createdAt: Date.now(),
    stats: player.stats ?? emptyStats(),
  };
  players.push(created);
  savePlayers(players);
  return created;
}

export function deletePlayer(id: string): void {
  savePlayers(getPlayers().filter((p) => p.id !== id));
}

export function getMatches(): StoredMatch[] {
  return read<StoredMatch[]>(KEYS.matches, []).sort((a, b) => b.finishedAt - a.finishedAt);
}

export function saveMatch(match: StoredMatch): void {
  const matches = getMatches().filter((m) => m.id !== match.id);
  matches.unshift(match);
  // Cap history
  write(KEYS.matches, matches.slice(0, 200));
}

export function getActiveGame(): GameState | null {
  return read<GameState | null>(KEYS.activeGame, null);
}

export function setActiveGame(state: GameState | null): void {
  if (state === null) {
    if (canUseStorage()) localStorage.removeItem(KEYS.activeGame);
    return;
  }
  write(KEYS.activeGame, state);
}

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<AppSettings>>(KEYS.settings, {}) };
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...settings };
  write(KEYS.settings, next);
  return next;
}

export function mergeMatchStatsIntoPlayers(match: StoredMatch): void {
  const players = getPlayers();
  for (const ps of match.summary.playerStats) {
    const p = players.find((x) => x.id === ps.playerId);
    if (!p || p.isGuest) continue;
    p.stats.matchesPlayed += 1;
    if (match.winnerId === p.id) p.stats.matchesWon += 1;
    p.stats.oneEighties += ps.oneEighties;
    p.stats.checkoutsHit += ps.checkouts;
    if (ps.highestCheckout > p.stats.highestCheckout) {
      p.stats.highestCheckout = ps.highestCheckout;
    }
    if (ps.avg > p.stats.bestThreeDartAvg) {
      p.stats.bestThreeDartAvg = ps.avg;
    }
  }
  // Also pull darts/score from full state
  for (const st of match.state.playerStates) {
    const p = players.find((x) => x.id === st.playerId);
    if (!p || p.isGuest) continue;
    p.stats.dartsThrown += st.dartsThrown;
    p.stats.totalScore += st.totalScore;
    p.stats.legsWon += st.legsWon + (match.winnerId === p.id ? 0 : 0);
    p.stats.checkoutAttempts += st.checkoutAttempts;
  }
  savePlayers(players);
}

export function leaderboard(
  metric: "avg" | "wins" | "oneEighties" | "checkouts" | "highestCheckout" = "avg"
): StoredPlayer[] {
  const players = getPlayers().filter((p) => !p.isGuest && p.stats.matchesPlayed > 0);
  return players.sort((a, b) => {
    switch (metric) {
      case "wins":
        return b.stats.matchesWon - a.stats.matchesWon;
      case "oneEighties":
        return b.stats.oneEighties - a.stats.oneEighties;
      case "checkouts":
        return b.stats.checkoutsHit - a.stats.checkoutsHit;
      case "highestCheckout":
        return b.stats.highestCheckout - a.stats.highestCheckout;
      case "avg":
      default: {
        const avgA = a.stats.dartsThrown ? (a.stats.totalScore / a.stats.dartsThrown) * 3 : 0;
        const avgB = b.stats.dartsThrown ? (b.stats.totalScore / b.stats.dartsThrown) * 3 : 0;
        return avgB - avgA;
      }
    }
  });
}

export function matchToCsv(match: StoredMatch): string {
  const lines = [
    "player,avg,180s,checkouts,highestCheckout",
    ...match.summary.playerStats.map(
      (p) =>
        `"${p.name}",${p.avg},${p.oneEighties},${p.checkouts},${p.highestCheckout}`
    ),
  ];
  return lines.join("\n");
}
