/**
 * Seat authentication for in-progress matches.
 *
 * Active games persist in localStorage independently of the tablet session cookie.
 * Registered (PIN) seats must stay verified across resume; guests never need PIN.
 * Sign-out / lost session for a seat invalidates that seat until PIN again.
 */

import type { PlayerRef } from "@/engine/types";

const KEY = "no3_seat_auth";

export type SeatAuthState = {
  matchId: string;
  /** Registered player ids that completed PIN/session verification for this match */
  verifiedPlayerIds: string[];
  /**
   * Tablet session player id when seats were last trusted.
   * If this id no longer matches the live session, that seat is treated as unsigned.
   */
  boundSessionPlayerId: string | null;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function getSeatAuth(): SeatAuthState | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SeatAuthState;
    if (!parsed?.matchId || !Array.isArray(parsed.verifiedPlayerIds)) return null;
    return {
      matchId: parsed.matchId,
      verifiedPlayerIds: parsed.verifiedPlayerIds.filter((id) => typeof id === "string"),
      boundSessionPlayerId:
        typeof parsed.boundSessionPlayerId === "string" ? parsed.boundSessionPlayerId : null,
    };
  } catch {
    return null;
  }
}

export function setSeatAuth(state: SeatAuthState | null): void {
  if (!canUseStorage()) return;
  try {
    if (state === null) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // quota / private mode
  }
}

export function clearSeatAuth(): void {
  setSeatAuth(null);
}

/** Seed verification when a match starts (all registered seats just passed PIN/session). */
export function seedSeatAuthForMatch(
  matchId: string,
  players: Array<Pick<PlayerRef, "id" | "name" | "isGuest" | "isBot">>,
  sessionPlayerId: string | null
): SeatAuthState {
  const verifiedPlayerIds = players
    .filter((p) => p.isGuest !== true && p.isBot !== true)
    .map((p) => p.id);
  const next: SeatAuthState = {
    matchId,
    verifiedPlayerIds,
    boundSessionPlayerId: sessionPlayerId,
  };
  setSeatAuth(next);
  return next;
}

/** Mark one registered seat verified (after resume PIN). */
export function markSeatVerified(matchId: string, playerId: string, sessionPlayerId: string | null): SeatAuthState {
  const prev = getSeatAuth();
  const verified = new Set(
    prev?.matchId === matchId ? prev.verifiedPlayerIds : []
  );
  verified.add(playerId);
  // Prefer the live tablet session; else keep prior bind; else bind the seat
  // just unlocked (empty-session resume PIN establishes that player's session).
  const boundSessionPlayerId =
    sessionPlayerId ??
    (prev?.matchId === matchId ? prev.boundSessionPlayerId : null) ??
    playerId;
  const next: SeatAuthState = {
    matchId,
    verifiedPlayerIds: [...verified],
    boundSessionPlayerId,
  };
  setSeatAuth(next);
  return next;
}

/** Drop a seat after sign-out (or explicit invalidate). */
export function invalidateSeat(playerId: string): SeatAuthState | null {
  const prev = getSeatAuth();
  if (!prev) return null;
  const verifiedPlayerIds = prev.verifiedPlayerIds.filter((id) => id !== playerId);
  const next: SeatAuthState = {
    matchId: prev.matchId,
    verifiedPlayerIds,
    boundSessionPlayerId:
      prev.boundSessionPlayerId === playerId ? null : prev.boundSessionPlayerId,
  };
  setSeatAuth(next);
  return next;
}

/**
 * Effective verified ids for a match given current tablet session.
 * - Current session player always counts as verified for their own seat.
 * - If the bound session player signed out / cookie cleared, that seat is dropped.
 */
export function effectiveVerifiedSeatIds(
  matchId: string,
  seatAuth: SeatAuthState | null,
  sessionPlayerId: string | null
): string[] {
  const ids = new Set<string>();
  if (seatAuth && seatAuth.matchId === matchId) {
    for (const id of seatAuth.verifiedPlayerIds) ids.add(id);
    if (
      seatAuth.boundSessionPlayerId &&
      seatAuth.boundSessionPlayerId !== sessionPlayerId
    ) {
      ids.delete(seatAuth.boundSessionPlayerId);
    }
  }
  if (sessionPlayerId) ids.add(sessionPlayerId);
  return [...ids];
}

/** Registered seats that must enter PIN before scoring may continue. */
export function seatsNeedingReauth(
  matchId: string,
  players: Array<Pick<PlayerRef, "id" | "name" | "isGuest" | "isBot">>,
  sessionPlayerId: string | null,
  seatAuth: SeatAuthState | null = getSeatAuth()
): Array<{ id: string; name: string }> {
  const verified = new Set(effectiveVerifiedSeatIds(matchId, seatAuth, sessionPlayerId));
  return players
    .filter((p) => p.isGuest !== true && p.isBot !== true && !verified.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }));
}

/** True when an in-progress match may accept scoring input. */
export function canScoreMatch(
  matchId: string,
  players: Array<Pick<PlayerRef, "id" | "name" | "isGuest" | "isBot">>,
  sessionPlayerId: string | null,
  seatAuth: SeatAuthState | null = getSeatAuth()
): boolean {
  return seatsNeedingReauth(matchId, players, sessionPlayerId, seatAuth).length === 0;
}
