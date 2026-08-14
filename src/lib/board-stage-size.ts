/**
 * Board stage sizing — TV and iPad are intentionally separate so HDMI flex
 * grow cannot leak into /play stay-put.
 */

/** HDMI /tv leftover column: largest square that fits. No max-size cap. */
export function tvBoardSide(stageWidth: number, stageHeight: number): number {
  const pad = 8;
  const side = Math.floor(Math.min(stageWidth, stageHeight) - pad);
  return Math.max(0, side);
}

/**
 * /play iPad reserved board cell. Cap 440 + min 200 — stay-put, never jump
 * when visit/seat chrome reflows.
 */
export function playBoardSide(stageWidth: number, stageHeight: number): number {
  const side = Math.floor(Math.min(stageWidth, stageHeight) - 20);
  if (side <= 0) return 0;
  return Math.max(200, Math.min(side, 440));
}
