/**
 * No3 Darts – Core engine types
 * Pure TypeScript, no UI dependencies. Designed so camera detection
 * can inject DartThrow events via REST/WebSocket later.
 */

/** Multiplier / segment kind for a single dart */
export type SegmentKind = "single" | "double" | "triple" | "outer_bull" | "bull" | "miss";

/**
 * A single dart landing.
 * - number: 1–20 for numbered segments (ignored for bull/miss)
 * - kind: segment type
 * - value: computed score contribution (engine may recompute)
 * - angle/radius: optional polar coords for heatmaps / CV (0–1 radius)
 */
export interface DartThrow {
  id: string;
  kind: SegmentKind;
  number: number; // 0 for miss/bulls when not used; 25 for outer, 50 for bull conceptually
  value: number;
  timestamp: number;
  /** Optional polar position for CV/heatmap (degrees 0–360, radius 0–1) */
  angle?: number;
  radius?: number;
  source?: "manual" | "camera" | "api";
}

export type GameModeId =
  | "x01"
  | "cricket"
  | "shanghai"
  | "countup"
  | "around_the_clock"
  | "bermuda"
  | "random_checkout"
  | "killer";

export type InOutRule = "straight" | "double" | "master";

export interface X01Config {
  startScore: 301 | 501 | 701 | 901;
  doubleIn: boolean;
  doubleOut: boolean; // master out can be added later via outRule
  outRule?: InOutRule;
}

export interface CricketConfig {
  variant: "standard" | "cutthroat";
  /** Numbers in play; default 15–20 + bull */
  numbers?: number[];
}

export interface ShanghaiConfig {
  /** Rounds 1–20 typically; can shorten */
  maxRound: number;
}

export interface CountUpConfig {
  /** Number of turns (3 darts each) */
  turns: number;
}

export interface AroundTheClockConfig {
  direction: "up" | "down";
  requireDouble: boolean;
  /** Include bull as final target */
  includeBull: boolean;
}

export interface BermudaConfig {
  /** Fixed target sequence length (classic 13 rounds) */
  rounds?: number;
}

export interface RandomCheckoutConfig {
  minScore: number;
  maxScore: number;
  /** Practice attempts */
  attempts: number;
}

/**
 * Killer (pub rules):
 * - Each player has a unique board number (1–20)
 * - Hit the double of your number → become a Killer
 * - Killers remove lives by hitting opponents' doubles
 * - Hitting your own double while a Killer costs you a life
 * - Last player with lives wins
 */
export interface KillerConfig {
  /** Starting lives per player (classic: 3) */
  lives: number;
  /**
   * playerId → board number 1–20.
   * Must be unique across players.
   */
  playerNumbers: Record<string, number>;
  /** If true, only doubles count to arm / kill (classic). */
  doublesOnly?: boolean;
}

export type ModeConfig =
  | { mode: "x01"; config: X01Config }
  | { mode: "cricket"; config: CricketConfig }
  | { mode: "shanghai"; config: ShanghaiConfig }
  | { mode: "countup"; config: CountUpConfig }
  | { mode: "around_the_clock"; config: AroundTheClockConfig }
  | { mode: "bermuda"; config: BermudaConfig }
  | { mode: "random_checkout"; config: RandomCheckoutConfig }
  | { mode: "killer"; config: KillerConfig };

export interface MatchFormat {
  legsToWin: number; // first to N legs (best of = 2N-1)
  setsToWin: number; // 1 = legs only
}

export interface PlayerRef {
  id: string;
  name: string;
  isGuest: boolean;
}

/**
 * Team of 1 (singles) or 2 (doubles).
 * Shared score/marks; individuals keep personal stats.
 */
export interface TeamRef {
  id: string;
  name: string;
  /** 1–2 player ids */
  playerIds: string[];
  /** Display / throw-order slot (0 = team A) */
  order: number;
}

/** Per-player runtime state (mode-specific extras in `extra`) */
export interface PlayerGameState {
  playerId: string;
  /** Team this player belongs to */
  teamId?: string;
  score: number;
  legsWon: number;
  setsWon: number;
  dartsThrown: number;
  totalScore: number; // cumulative points scored (for averages) — individual
  first9Total: number;
  first9Darts: number;
  checkoutAttempts: number;
  checkoutsHit: number;
  oneEighties: number;
  highestCheckout: number;
  /** Cricket marks: number -> 0–3+ marks (shared with team) */
  marks?: Record<number, number>;
  /** Around the clock: next target (shared with team) */
  nextTarget?: number;
  /** Has opened (double-in) — shared with team */
  hasOpened?: boolean;
  /** Mode-specific bag */
  extra?: Record<string, unknown>;
}

export interface Turn {
  playerId: string;
  darts: DartThrow[];
  startScore: number;
  endScore: number;
  bust: boolean;
  checkout: boolean;
  timestamp: number;
}

export type GameStatus = "setup" | "playing" | "leg_won" | "match_won" | "paused" | "finished";

export interface GameState {
  id: string;
  status: GameStatus;
  mode: GameModeId;
  modeConfig: ModeConfig;
  matchFormat: MatchFormat;
  players: PlayerRef[];
  playerStates: PlayerGameState[];
  /**
   * Teams (singles = 1 player each, doubles = 2).
   * Always populated; solo FFA is N teams of 1.
   */
  teams: TeamRef[];
  /**
   * Indices into `players` for throw order.
   * Doubles 2v2: A1, B1, A2, B2.
   */
  throwOrder: number[];
  currentPlayerIndex: number;
  currentTurnDarts: DartThrow[];
  turns: Turn[];
  legNumber: number;
  setNumber: number;
  /** Current Bermuda / Shanghai round target index */
  roundIndex: number;
  /** Winning player id (thrower) — use team via getTeamForPlayer for display */
  winnerId: string | null;
  legWinnerId: string | null;
  winnerTeamId?: string | null;
  legWinnerTeamId?: string | null;
  createdAt: number;
  updatedAt: number;
  roomId?: string;
  pausedAt?: number | null;
  /**
   * Snapshot of playerStates at the start of the current visit.
   * Used for Autodarts-style mid-turn corrections (rebuild turn from baseline).
   */
  turnBaseline?: PlayerGameState[] | null;
}

export interface EngineEvent {
  type:
    | "dart"
    | "bust"
    | "turn_end"
    | "leg_won"
    | "set_won"
    | "match_won"
    | "undo"
    | "pause"
    | "resume";
  payload?: unknown;
  timestamp: number;
}

export interface ApplyDartResult {
  state: GameState;
  events: EngineEvent[];
  /** Human-readable callout e.g. "T20", "180", "Game shot" */
  callout?: string;
}

export interface CheckoutSuggestion {
  remaining: number;
  darts: Array<{ label: string; kind: SegmentKind; number: number; value: number }>;
  description: string;
}

/** Camera / external detection payload (Phase 2) */
export interface DartDetectedEvent {
  roomId?: string;
  matchId?: string;
  kind: SegmentKind;
  number: number;
  value?: number;
  angle?: number;
  radius?: number;
  confidence?: number;
  timestamp?: number;
}
