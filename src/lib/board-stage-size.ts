/**
 * Board stage sizing — TV and iPad use separate helpers/CSS so HDMI flex
 * cannot leak into /play. Stay-put = reserved cell, no mid-match jump.
 * It does NOT mean a postage-stamp max-size cap.
 */

/** HDMI /tv leftover column: largest square that fits. No max-size cap. */
export function tvBoardSide(stageWidth: number, stageHeight: number): number {
  const pad = 8;
  const side = Math.floor(Math.min(stageWidth, stageHeight) - pad);
  return Math.max(0, side);
}

/**
 * /play iPad reserved board cell. Fill the leftover square (no 440 cap).
 * Size comes only from the reserved stage so takeout / dart 3 / seat
 * chrome cannot move the graphic.
 */
export function playBoardSide(stageWidth: number, stageHeight: number): number {
  const pad = 12;
  const side = Math.floor(Math.min(stageWidth, stageHeight) - pad);
  return Math.max(200, side);
}
