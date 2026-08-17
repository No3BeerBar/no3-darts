/**
 * Public game-engine API – import from `@/engine` only.
 */

export * from "./types";
export * from "./dart";
export * from "./checkout";
export * from "./engine";
export { defaultModeConfig, resolveModeConfig } from "./mode-defaults";
export * from "./teams";
export {
  BOT_BETWEEN_DARTS_MS,
  BOT_DIFFICULTY_ORDER,
  BOT_PROFILES,
  BOT_TURN_START_DELAY_MS,
  createBotSeat,
  generateBotVisit,
  generateNextBotDart,
  generateNextBotDartForPlayer,
  getBotProfile,
  isBotPlayer,
  planBotTurn,
  resolveBotDifficulty,
  type BotProfile,
  type BotTurnPlan,
} from "./bot";
export { BERMUDA_SEQUENCE, bermudaTargetLabel } from "./modes/bermuda";
export {
  getKillerExtra,
  killerBoardFocus,
  validateKillerNumbers,
  type KillerExtra,
} from "./modes/killer";
export {
  BASEBALL_INNINGS,
  baseballDartPoints,
  baseballInning,
  baseballTarget,
  baseballVisitPoints,
} from "./modes/baseball";
export {
  FORTY_ONE_SEQUENCE,
  FORTY_ONE_START_SCORE,
  fortyOneBoardFocus,
  fortyOneDartPoints,
  fortyOneExact41DartContributes,
  fortyOneExact41GoneOver,
  fortyOneExact41VisitOk,
  fortyOneHalve,
  fortyOneRoundNumber,
  fortyOneTarget,
  fortyOneTargetLabel,
  fortyOneVisitRawSum,
  fortyOneVisitResult,
  type FortyOneTarget,
} from "./modes/forty-one";
export {
  baseballVisitTotalFromDarts,
  dartPointsForMode,
  visitPointsFromTurn,
} from "./visit-score";
export {
  computePlayerRoundStats,
  formatRoundStat,
  marksFromDart,
  roundStatsForMode,
  type PlayerRoundStats,
  type RoundStatKind,
  type RoundStatValue,
} from "./player-stats";
