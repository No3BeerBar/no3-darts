/**
 * Shared camera / Board Manager health shape (companion bridge → No3 clients).
 */

export type CameraHealth = {
  roomId: string;
  ok: boolean;
  level: "ok" | "degraded" | "unhealthy" | "takeout" | string;
  message: string;
  reason?: string;
  fps?: number[];
  minFps?: number | null;
  cameras?: unknown[];
  connected?: boolean;
  status?: string;
  unhealthyForS?: number;
  restarting?: boolean;
  /** Autodarts remove-darts / takeout mode — scoring paused on the bridge. */
  takeout?: boolean;
  ts: number;
};

/**
 * Health older than this is not a live Autodarts / bridge takeout signal.
 * Spec: 15–30s TTL. Bridge takeout heartbeats are ~8s.
 */
export const CAMERA_HEALTH_FRESH_MS = 30_000;

/** True when the companion reports AD/Board Manager unreachable (or no report). */
export function isCameraBridgeOffline(
  h: CameraHealth | null | undefined
): boolean {
  if (!h) return true;
  if (h.connected === false) return true;
  if (h.reason === "board_manager_offline") return true;
  return false;
}

/**
 * Autodarts Board State / Detection State that means "pull darts".
 * Yellow Reset is the same patron-facing pause as Takeout.
 * "Takeout finished" and Ready/cleared copy are not active takeout.
 */
export function isAutodartsRemoveDartsStatus(
  status?: string | null
): boolean {
  const s = (status || "").trim().toLowerCase().replace(/_/g, " ");
  if (!s) return false;
  if (s.includes("takeout finished") || s.replace(/\s/g, "") === "takeoutfinished") {
    return false;
  }
  if (s.includes("cleared") || s.includes("ready")) return false;
  const compact = s.replace(/\s/g, "");
  if (s === "reset" || s === "board reset" || compact === "reset") return true;
  if (
    s === "takeout" ||
    s === "takeout started" ||
    s === "hand" ||
    s === "partial takeout"
  ) {
    return true;
  }
  if (
    s.includes("removing dart") ||
    s.includes("remove dart") ||
    s.includes("pull dart")
  ) {
    return true;
  }
  if (s.includes("takeout")) return true;
  return false;
}

/** Bridge / patron explicitly ended takeout (Ready, stale clear, offline). */
export function isExplicitTakeoutClear(
  h: CameraHealth | null | undefined
): boolean {
  if (!h) return false;
  if (
    h.reason === "takeout_cleared" ||
    h.reason === "takeout_stale_cleared" ||
    h.reason === "board_manager_offline"
  ) {
    return true;
  }
  const msg = (h.message || "").toLowerCase();
  if (msg.includes("ready for next visit")) return true;
  if (msg.includes("takeout reset") && msg.includes("ready")) return true;
  return false;
}

/**
 * Health row says Autodarts is in takeout / yellow Reset — including when
 * the companion sent status=Reset without takeout:true.
 */
export function healthIndicatesTakeout(
  h: Pick<CameraHealth, "takeout" | "level" | "reason" | "status" | "message">
): boolean {
  if (isExplicitTakeoutClear(h as CameraHealth)) return false;
  if (Boolean(h.takeout) || h.level === "takeout" || h.reason === "takeout") {
    return true;
  }
  return isAutodartsRemoveDartsStatus(h.status);
}

/**
 * Takeout is active when health indicates remove-darts / Reset, the bridge
 * is connected, and the row is fresh (≤30s).
 * Else clients/server must clear takeout UI + holdUntilTakeoutClear.
 */
export function isLiveTakeoutSignal(
  h: CameraHealth | null | undefined,
  now = Date.now()
): boolean {
  if (!h) return false;
  // Exact gate: connected===false kills takeout (undefined still allowed).
  if (h.connected === false) return false;
  if (h.reason === "board_manager_offline") return false;
  if (!healthIndicatesTakeout(h)) return false;
  if (typeof h.ts !== "number" || now - h.ts > CAMERA_HEALTH_FRESH_MS) {
    return false;
  }
  return true;
}

/**
 * Banner visibility. Never hide a live takeout. A missed/null poll must not
 * clear an already-showing banner. Hide only on explicit clear, offline, or
 * a fresh non-takeout health row (Throw / cameras healthy).
 */
export function shouldShowTakeoutUi(opts: {
  health: CameraHealth | null | undefined;
  currentlyShowing: boolean;
  now?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  if (isLiveTakeoutSignal(opts.health, now)) return true;
  if (!opts.currentlyShowing) return false;
  if (!opts.health) return true;
  if (isCameraBridgeOffline(opts.health)) return false;
  if (isExplicitTakeoutClear(opts.health)) return false;
  if (isStaleCameraHealth(opts.health, now)) return false;
  return false;
}

/** Stale leftover takeout row (no fresh bridge heartbeat). */
export function isStaleCameraHealth(
  h: CameraHealth | null | undefined,
  now = Date.now()
): boolean {
  if (!h) return true;
  if (typeof h.ts !== "number") return true;
  return now - h.ts > CAMERA_HEALTH_FRESH_MS;
}

/** Explicit connected gate used by server/client docs + tests. */
export function isConnectedForTakeout(
  h: CameraHealth | null | undefined
): boolean {
  return Boolean(h) && h!.connected !== false;
}
