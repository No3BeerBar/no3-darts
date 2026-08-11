/**
 * Public game-engine API – import from `@/engine` only.
 */

export * from "./types";
export * from "./dart";
export * from "./checkout";
export * from "./engine";
export * from "./teams";
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
