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
  /**
   * Server next-seat hold (visit closed, camera paused). Stamped by
   * getCameraHealth so /play and /tv can show Reset after undo/correct
   * even when Autodarts is in yellow reset and takeout:true was not posted.
   */
  holdUntilTakeoutClear?: boolean;
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
 * Autodarts board/detection copy that means remove-darts / yellow reset.
 * Used when the companion posts Cameras healthy with takeout:false but
 * status is still Takeout / Reset / Removing darts (undo desync).
 */
export function statusLooksLikeTakeout(raw?: string | null): boolean {
  if (!raw) return false;
  const s = raw.trim().toLowerCase().replace(/_/g, " ");
  if (!s) return false;
  if (s.includes("takeout finished") || s.replace(/\s/g, "") === "takeoutfinished") {
    return false;
  }
  if (s.includes("between")) return false;
  if (s.includes("ready for next")) return false;
  if (s.includes("takeout reset") || s.includes("takeout cleared")) return false;
  if (s.includes("takeout")) return true;
  if (s.includes("removing dart") || s.includes("remove dart") || s.includes("pull dart")) {
    return true;
  }
  if (s === "hand" || s.includes("partial takeout")) return true;
  if (s === "reset" || s === "resetting" || s === "board reset" || s.startsWith("reset ")) {
    return true;
  }
  if (s.includes("yellow reset")) return true;
  return false;
}

/**
 * Takeout is active when:
 *   (takeout flag / level / reason OR AD status looks like takeout)
 *   && connected !== false && health ts fresh (≤30s)
 * Explicit takeout_cleared / Ready wins so Reset can dismiss the banner.
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
  if (h.reason === "takeout_cleared") return false;
  if (/ready for next visit/i.test(h.message || "")) return false;
  const active =
    Boolean(h.takeout) ||
    h.level === "takeout" ||
    h.reason === "takeout" ||
    statusLooksLikeTakeout(h.status) ||
    statusLooksLikeTakeout(h.message);
  if (!active) return false;
  if (typeof h.ts !== "number" || now - h.ts > CAMERA_HEALTH_FRESH_MS) {
    return false;
  }
  return true;
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

/**
 * Show Reset takeout on /play and /tv when Autodarts is in live takeout
 * OR the server is holding the next seat (silent hold after undo/correct).
 * Sandbox / offline / stale leftover still hide the banner.
 */
export function shouldShowTakeoutUi(
  h: CameraHealth | null | undefined,
  now = Date.now()
): boolean {
  if (isLiveTakeoutSignal(h, now)) return true;
  if (!h) return false;
  if (isCameraBridgeOffline(h)) return false;
  if (isStaleCameraHealth(h, now)) return false;
  return Boolean(h.holdUntilTakeoutClear);
}
