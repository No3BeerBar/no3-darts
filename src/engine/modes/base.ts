/**
 * Base mode interface – each game mode implements this.
 */

import type {
  ApplyDartResult,
  DartThrow,
  GameState,
  ModeConfig,
  PlayerGameState,
  PlayerRef,
} from "../types";

export interface GameModeHandler {
  id: string;
  displayName: string;
  description: string;

  /** Initialize player states for a new leg */
  initLeg(state: GameState): GameState;

  /** Apply a dart; return updated state + events */
  applyDart(state: GameState, dart: DartThrow): ApplyDartResult;

  /** Whether the current turn should auto-end after this dart */
  shouldEndTurn(state: GameState): boolean;

  /** Optional display helpers */
  getRemaining?(state: GameState, playerId: string): number;
  getStatusLine?(state: GameState): string;
}

export function createEmptyPlayerState(
  player: PlayerRef,
  startScore = 0,
  teamId?: string
): PlayerGameState {
  return {
    playerId: player.id,
    teamId,
    score: startScore,
    legsWon: 0,
    setsWon: 0,
    dartsThrown: 0,
    totalScore: 0,
    first9Total: 0,
    first9Darts: 0,
    checkoutAttempts: 0,
    checkoutsHit: 0,
    oneEighties: 0,
    highestCheckout: 0,
    marks: {},
    nextTarget: 1,
    hasOpened: false,
    extra: {},
  };
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export function currentPlayer(state: GameState): PlayerRef {
  return state.players[state.currentPlayerIndex];
}

export function currentPlayerState(state: GameState): PlayerGameState {
  return state.playerStates[state.currentPlayerIndex];
}

type ConfigOf<T extends ModeConfig["mode"]> = Extract<ModeConfig, { mode: T }>["config"];

export function getModeConfig<T extends ModeConfig["mode"]>(
  state: GameState,
  mode: T
): ConfigOf<T> {
  if (state.modeConfig.mode !== mode) {
    throw new Error(`Expected mode ${mode}, got ${state.modeConfig.mode}`);
  }
  return state.modeConfig.config as ConfigOf<T>;
}
