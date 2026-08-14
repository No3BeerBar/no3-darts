/**
 * Display-only takeout freeze: keep the last visit on screen while Autodarts
 * is in takeout. Engine / seat lock / expectedPlayerIndex are unchanged.
 */

import type { DartThrow, GameState } from "@/engine";

export type TakeoutVisitDisplay = {
  playerIndex: number;
  darts: DartThrow[];
  /** True when we replay the last finalized turn (seat already advanced). */
  holdingLastVisit: boolean;
};

/**
 * After dart 3 the engine usually ends the visit (empty currentTurnDarts,
 * next seat selected) before takeout UI appears. Show that last player and
 * their three darts until takeout clears.
 */
export function takeoutVisitDisplay(
  state: GameState,
  takeoutActive: boolean
): TakeoutVisitDisplay {
  if (!takeoutActive) {
    return {
      playerIndex: state.currentPlayerIndex,
      darts: state.currentTurnDarts,
      holdingLastVisit: false,
    };
  }
  if (state.currentTurnDarts.length > 0) {
    return {
      playerIndex: state.currentPlayerIndex,
      darts: state.currentTurnDarts,
      holdingLastVisit: false,
    };
  }
  const last = state.turns[state.turns.length - 1];
  if (!last?.darts.length) {
    return {
      playerIndex: state.currentPlayerIndex,
      darts: state.currentTurnDarts,
      holdingLastVisit: false,
    };
  }
  const playerIndex = state.players.findIndex((p) => p.id === last.playerId);
  return {
    playerIndex: playerIndex >= 0 ? playerIndex : state.currentPlayerIndex,
    darts: last.darts,
    holdingLastVisit: true,
  };
}
