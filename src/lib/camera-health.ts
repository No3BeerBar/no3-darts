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
 * Takeout is active only when:
 *   takeout && connected !== false && health ts fresh (≤30s)
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
  const active =
    Boolean(h.takeout) || h.level === "takeout" || h.reason === "takeout";
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
