/**
 * Fresh document load onto board/kiosk play surfaces (`/play` or setup `/`).
 *
 * Opening the board bookmark (or any new document load of play/setup) must not
 * leave a sticky session cookie / tablet roster looking "signed in" without PIN,
 * and must clear seat scoring trust when an active match is restored.
 *
 * Continuous SPA after the first gate keeps stay-signed-in between matches
 * (end-game → setup → next game) and mid-match seat trust after re-PIN.
 */

import { clearSeatAuth, invalidateSeatAuthOnPageRestore } from "@/lib/seat-auth";
import { getActiveGame } from "@/lib/storage";
import { clearTabletSessionPlayers } from "@/lib/tablet-session";

/** Once per JS document lifetime — survives SPA hops, resets on full reload. */
let documentEntryConsumed = false;

export function playDocumentEntryAlreadyGated(): boolean {
  return documentEntryConsumed;
}

/** Test-only: allow another gate in the same vitest isolate. */
export function resetPlayDocumentEntryGateForTests(): void {
  documentEntryConsumed = false;
}

export type PlayDocumentEntryGateResult = {
  /** True when this call performed the once-per-document clear. */
  gated: boolean;
  clearedSeatAuth: boolean;
  clearedTabletRoster: boolean;
};

/**
 * Sync local clears for a fresh play/setup document entry.
 * Caller should `await clearPlayEntrySessionCookie()` when `gated` is true,
 * then treat the tablet as cold (do not re-hydrate sticky cookie into UI).
 */
export function gatePlayDocumentEntry(): PlayDocumentEntryGateResult {
  if (typeof window === "undefined") {
    return { gated: false, clearedSeatAuth: false, clearedTabletRoster: false };
  }
  if (documentEntryConsumed) {
    return { gated: false, clearedSeatAuth: false, clearedTabletRoster: false };
  }
  documentEntryConsumed = true;

  const active = getActiveGame();
  if (active) {
    invalidateSeatAuthOnPageRestore(active.id);
  } else {
    clearSeatAuth();
  }
  clearTabletSessionPlayers();

  return { gated: true, clearedSeatAuth: true, clearedTabletRoster: true };
}

/** Drop the httpOnly session cookie so /api/auth/me cannot revive "Signed in". */
export async function clearPlayEntrySessionCookie(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    /* offline — local roster already cleared; UI stays cold until PIN */
  }
}
