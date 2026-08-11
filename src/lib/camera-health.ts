/**
 * Shared camera / Board Manager health shape (companion bridge → No3 clients).
 */

export type CameraHealth = {
  roomId: string;
  ok: boolean;
  level: "ok" | "degraded" | "unhealthy" | string;
  message: string;
  reason?: string;
  fps?: number[];
  minFps?: number | null;
  cameras?: unknown[];
  connected?: boolean;
  status?: string;
  unhealthyForS?: number;
  restarting?: boolean;
  ts: number;
};
