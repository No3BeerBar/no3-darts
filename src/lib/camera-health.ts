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
 * Bridge takeout heartbeats are ~8s; ok heartbeats ~20s while degraded.
 */
export const CAMERA_HEALTH_FRESH_MS = 45_000;

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
 * Patron Pull-darts / Removing-darts UI + camera takeout gating may only arm
 * from a *live* Autodarts takeout signal. Sandbox / no bridge / AD offline /
 * stale leftover health must never sticky-loop the banner or toast.
 */
export function isLiveTakeoutSignal(
  h: CameraHealth | null | undefined,
  now = Date.now()
): boolean {
  if (!h) return false;
  if (isCameraBridgeOffline(h)) return false;
  const active =
    Boolean(h.takeout) || h.level === "takeout" || h.reason === "takeout";
  if (!active) return false;
  if (typeof h.ts === "number" && now - h.ts > CAMERA_HEALTH_FRESH_MS) {
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
