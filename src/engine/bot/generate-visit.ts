/**
 * Bot visit / next-dart generation — mode-aware.
 *
 * X01, Cricket, 41, Baseball, and Killer each have first-class planners.
 * Other modes fall through a small generic path (ATC / Bermuda / Shanghai / …).
 */

import { getCheckoutSuggestion } from "../checkout";
import { createDart } from "../dart";
import { applyDart, getRemaining } from "../engine";
import { baseballInning } from "../modes/baseball";
import { fortyOneTarget, type FortyOneTarget } from "../modes/forty-one";
import { getKillerExtra } from "../modes/killer";
import type { DartThrow, GameState, SegmentKind } from "../types";
import {
  defaultRng,
  resolveAim,
  resolveCheckoutAim,
  type AimTarget,
  type Rng,
} from "./aim";
import {
  getBotProfile,
  resolveBotDifficulty,
  type BotDifficulty,
  type BotProfile,
} from "./profiles";

const CRICKET_ORDER = [20, 19, 18, 17, 16, 15, 25] as const;

/** Preferred doubles for “any double” rounds (fat / common beds). */
const SENSIBLE_DOUBLES = [20, 16, 10, 8, 18, 12, 4] as const;
/** Preferred triples for “any triple” rounds. */
const SENSIBLE_TRIPLES = [20, 19, 18, 17, 16] as const;

/**
 * Classic 3-dart combinations that sum to exactly 41 (all contribute).
 * Prefer treble-led routes; avoid leaving a one-dart remainder that needs a miss.
 */
const EXACT_41_OPENERS: AimTarget[] = [
  { kind: "triple", number: 13 }, // 39 → leave 2 (S1 S1)
  { kind: "triple", number: 11 }, // 33 → leave 8
  { kind: "triple", number: 9 }, // 27 → leave 14
  { kind: "triple", number: 7 }, // 21 → leave 20
  { kind: "triple", number: 12 }, // 36 → leave 5
  { kind: "triple", number: 10 }, // 30 → leave 11
  { kind: "single", number: 20 }, // 20 → leave 21
  { kind: "single", number: 19 }, // 19 → leave 22
];

function botDart(kind: SegmentKind, number: number): DartThrow {
  return createDart(kind, number, { source: "bot" });
}

function scoringAim(profile: BotProfile, remaining: number, rng: Rng): AimTarget {
  // Prefer not to leave awkward remainders when close but not on a finish.
  if (remaining > 60 && remaining <= 100 && rng() < 0.35) {
    return { kind: rng() < profile.trebleBias ? "triple" : "single", number: 20 };
  }
  // Nuke-style / heavy T20; occasional T19 cover.
  if (rng() < profile.trebleBias) return { kind: "triple", number: 20 };
  if (rng() < 0.15) return { kind: "triple", number: 19 };
  return { kind: "single", number: 20 };
}

function x01NextDart(state: GameState, profile: BotProfile, rng: Rng): DartThrow {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return botDart("miss", 0);
  const remaining = getRemaining(state, player.id);
  const dartsLeft = 3 - state.currentTurnDarts.length;
  const doubleOut =
    state.modeConfig.mode === "x01" ? state.modeConfig.config.doubleOut : true;
  const doubleIn =
    state.modeConfig.mode === "x01" ? state.modeConfig.config.doubleIn : false;

  const ps = state.playerStates.find((p) => p.playerId === player.id);
  if (doubleIn && ps && !ps.hasOpened) {
    return resolveCheckoutAim({ kind: "double", number: 16 }, profile, rng);
  }

  if (remaining <= 1) return botDart("miss", 0);

  // Uses curated routes (141 = T20 T19 D12, 170 = T20 T20 Bull, …) — Luke’s classics.
  const checkout = getCheckoutSuggestion(remaining, dartsLeft, doubleOut);
  if (checkout && checkout.darts.length > 0) {
    const step = checkout.darts[0]!;
    const aim: AimTarget =
      step.kind === "bull"
        ? { kind: "bull" }
        : step.kind === "outer_bull"
          ? { kind: "outer_bull" }
          : { kind: step.kind as "single" | "double" | "triple", number: step.number };

    if (aim.kind === "double" || aim.kind === "bull") {
      return resolveCheckoutAim(aim, profile, rng);
    }
    return resolveAim(aim, profile, rng);
  }

  if (remaining <= 60) {
    const aim = scoringAim(profile, remaining, rng);
    let dart = resolveAim(aim, profile, rng);
    if (doubleOut) {
      if (dart.value >= remaining) {
        const safe = Math.min(20, Math.max(1, remaining - 2));
        dart = resolveAim({ kind: "single", number: safe }, profile, rng);
        if (dart.value >= remaining || remaining - dart.value === 1) {
          return botDart("miss", 0);
        }
      }
    } else if (dart.value > remaining) {
      return botDart("miss", 0);
    }
    return dart;
  }

  return resolveAim(scoringAim(profile, remaining, rng), profile, rng);
}

function cricketNextDart(state: GameState, profile: BotProfile, rng: Rng): DartThrow {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return botDart("miss", 0);
  const ps = state.playerStates.find((p) => p.playerId === player.id);
  const marks = ps?.marks ?? {};

  let targetNum: number = 20;
  for (const n of CRICKET_ORDER) {
    if ((marks[n] ?? 0) < 3) {
      targetNum = n;
      break;
    }
  }

  if (targetNum === 25) {
    if (rng() < profile.cricketAccuracy) {
      return rng() < 0.55 ? botDart("bull", 50) : botDart("outer_bull", 25);
    }
    return resolveAim({ kind: "outer_bull" }, profile, rng);
  }

  const marksNeeded = 3 - (marks[targetNum] ?? 0);
  const aimTriple = marksNeeded >= 2 && rng() < profile.trebleBias;
  const aim: AimTarget = aimTriple
    ? { kind: "triple", number: targetNum }
    : marksNeeded === 1 && rng() < 0.4
      ? { kind: "single", number: targetNum }
      : { kind: rng() < profile.trebleBias ? "triple" : "single", number: targetNum };

  if (rng() > profile.cricketAccuracy) {
    return resolveAim(aim, { ...profile, aimAccuracy: profile.cricketAccuracy * 0.5 }, rng);
  }
  return resolveAim(aim, { ...profile, aimAccuracy: Math.max(profile.cricketAccuracy, 0.7) }, rng);
}

/** One-dart face-value aim for exact-41 remainders (or null if impossible). */
export function aimExactFaceValue(value: number): AimTarget | null {
  if (value <= 0) return null;
  if (value === 50) return { kind: "bull" };
  if (value === 25) return { kind: "outer_bull" };
  if (value >= 1 && value <= 20) return { kind: "single", number: value };
  if (value % 2 === 0) {
    const n = value / 2;
    if (n >= 1 && n <= 20) return { kind: "double", number: n };
  }
  if (value % 3 === 0) {
    const n = value / 3;
    if (n >= 1 && n <= 20) return { kind: "triple", number: n };
  }
  return null;
}

/** True when `value` can be scored with a single legal dart segment. */
function isOneDartFaceValue(value: number): boolean {
  return aimExactFaceValue(value) != null;
}

/**
 * Pick an aim that scores some of `remaining` and leaves a one-dart finish
 * for the following dart when possible.
 */
function aimExact41TwoDarts(remaining: number, rng: Rng): AimTarget {
  // Prefer setups that leave a clean single / double / treble / bull.
  const candidates: AimTarget[] = [];
  for (let n = 20; n >= 1; n--) {
    for (const kind of ["triple", "double", "single"] as const) {
      const v = kind === "triple" ? n * 3 : kind === "double" ? n * 2 : n;
      if (v >= remaining) continue;
      const leave = remaining - v;
      if (leave > 0 && isOneDartFaceValue(leave)) {
        candidates.push({ kind, number: n });
      }
    }
  }
  if (remaining > 25 && remaining - 25 > 0 && isOneDartFaceValue(remaining - 25)) {
    candidates.push({ kind: "outer_bull" });
  }
  if (remaining > 50 && remaining - 50 > 0 && isOneDartFaceValue(remaining - 50)) {
    candidates.push({ kind: "bull" });
  }
  if (candidates.length > 0) {
    return candidates[Math.floor(rng() * candidates.length)]!;
  }
  // Fallback: chase a high single / treble under the remaining.
  if (remaining > 20) return { kind: "triple", number: Math.min(20, Math.floor((remaining - 1) / 3)) || 1 };
  return { kind: "single", number: Math.max(1, Math.min(20, remaining - 1)) };
}

/**
 * Intended aim for the current 41 round (before skill noise).
 * Exported for unit tests — bots must track the round target, not spam T20.
 */
export function planFortyOneAim(
  state: GameState,
  profile: BotProfile,
  rng: Rng = defaultRng
): AimTarget {
  const target = fortyOneTarget(state);
  return planFortyOneAimForTarget(target, state.currentTurnDarts, profile, rng);
}

export function planFortyOneAimForTarget(
  target: FortyOneTarget,
  currentDarts: DartThrow[],
  profile: BotProfile,
  rng: Rng = defaultRng
): AimTarget {
  switch (target.type) {
    case "number": {
      // Valid S/D/T of the round number all score — prefer treble when skilled.
      return {
        kind: rng() < profile.trebleBias ? "triple" : "single",
        number: target.n,
      };
    }
    case "any_double": {
      const idx = Math.min(
        SENSIBLE_DOUBLES.length - 1,
        Math.floor(rng() * (profile.checkoutSkill > 0.35 ? 4 : SENSIBLE_DOUBLES.length))
      );
      return { kind: "double", number: SENSIBLE_DOUBLES[idx]! };
    }
    case "any_triple": {
      const idx = Math.min(
        SENSIBLE_TRIPLES.length - 1,
        Math.floor(rng() * (profile.trebleBias > 0.7 ? 3 : SENSIBLE_TRIPLES.length))
      );
      return { kind: "triple", number: SENSIBLE_TRIPLES[idx]! };
    }
    case "bull":
      return rng() < 0.65 ? { kind: "bull" } : { kind: "outer_bull" };
    case "exact_41":
      return planExact41Aim(currentDarts, rng);
  }
}

function planExact41Aim(currentDarts: DartThrow[], rng: Rng): AimTarget {
  const dartsLeft = 3 - currentDarts.length;
  // Visit already void (miss / zero) — still throw a small scoring dart, not T20 spam.
  for (const d of currentDarts) {
    if (d.kind === "miss" || d.value <= 0) {
      return { kind: "single", number: 1 };
    }
  }
  const scored = currentDarts.reduce((a, d) => a + d.value, 0);
  const remaining = 41 - scored;

  if (remaining <= 0) {
    // Already over — cannot recover; aim tiny to avoid looking like X01.
    return { kind: "single", number: 1 };
  }

  if (dartsLeft <= 1) {
    return aimExactFaceValue(remaining) ?? { kind: "single", number: Math.min(20, remaining) };
  }

  if (dartsLeft === 2) {
    return aimExact41TwoDarts(remaining, rng);
  }

  // Three darts: open with a planned combination (not three T20s).
  return EXACT_41_OPENERS[Math.floor(rng() * EXACT_41_OPENERS.length)]!;
}

function fortyOneNextDart(state: GameState, profile: BotProfile, rng: Rng): DartThrow {
  const aim = planFortyOneAim(state, profile, rng);
  // Doubles / bull rounds use checkout skill (same beds as finishes).
  if (aim.kind === "double" || aim.kind === "bull") {
    return resolveCheckoutAim(aim, profile, rng);
  }
  return resolveAim(aim, profile, rng);
}

function baseballNextDart(state: GameState, profile: BotProfile, rng: Rng): DartThrow {
  const inning = baseballInning(state);
  // Only S/D/T of the inning number score — never T20 unless inning is 20 (impossible).
  const aim: AimTarget = {
    kind: rng() < profile.trebleBias ? "triple" : "single",
    number: inning,
  };
  return resolveAim(aim, profile, rng);
}

function killerNextDart(state: GameState, profile: BotProfile, rng: Rng): DartThrow {
  const player = state.players[state.currentPlayerIndex];
  const ps = state.playerStates.find((p) => p.playerId === player?.id);
  const extra = ps ? getKillerExtra(ps) : null;
  if (extra && !extra.isKiller) {
    return resolveCheckoutAim({ kind: "double", number: extra.killerNumber }, profile, rng);
  }
  const others = state.playerStates
    .filter((p) => p.playerId !== player?.id)
    .map((p) => getKillerExtra(p))
    .filter((k) => k && !k.eliminated);
  const prey = others[Math.floor(rng() * Math.max(others.length, 1))];
  if (prey) {
    return resolveCheckoutAim({ kind: "double", number: prey.killerNumber }, profile, rng);
  }
  return botDart("miss", 0);
}

/** Fallback for Shanghai / count-up / ATC / Bermuda / … */
export function generateGenericBotDart(
  state: GameState,
  profile: BotProfile,
  rng: Rng = defaultRng
): DartThrow {
  // Kept for backward compatibility — first-class modes should not land here.
  if (state.mode === "baseball") return baseballNextDart(state, profile, rng);
  if (state.mode === "forty_one") return fortyOneNextDart(state, profile, rng);
  if (state.mode === "killer") return killerNextDart(state, profile, rng);

  if (state.mode === "around_the_clock") {
    const player = state.players[state.currentPlayerIndex];
    const ps = state.playerStates.find((p) => p.playerId === player?.id);
    const next = ps?.nextTarget ?? 1;
    if (next === 25 || next === 50) {
      return resolveCheckoutAim({ kind: "bull" }, profile, rng);
    }
    return resolveAim({ kind: "single", number: Math.min(20, Math.max(1, next)) }, profile, rng);
  }

  if (state.mode === "random_checkout") {
    return x01NextDart(state, profile, rng);
  }

  // Shanghai / count-up / Bermuda — score T20-ish
  return resolveAim(
    { kind: rng() < profile.trebleBias ? "triple" : "single", number: 20 },
    profile,
    rng
  );
}

/**
 * Next dart for the current thrower given difficulty.
 * Returns null if the game is not in a throwable state.
 */
export function generateNextBotDart(
  state: GameState,
  difficulty: BotDifficulty,
  rng: Rng = defaultRng
): DartThrow | null {
  if (state.status !== "playing") return null;
  const profile = getBotProfile(difficulty);

  switch (state.mode) {
    case "x01":
      return x01NextDart(state, profile, rng);
    case "cricket":
      return cricketNextDart(state, profile, rng);
    case "forty_one":
      return fortyOneNextDart(state, profile, rng);
    case "baseball":
      return baseballNextDart(state, profile, rng);
    case "killer":
      return killerNextDart(state, profile, rng);
    default:
      return generateGenericBotDart(state, profile, rng);
  }
}

/**
 * Simulate a full visit (up to 3 darts) against a cloned engine state.
 * Useful for tests / previews. Live play should apply darts one-by-one
 * via the store so UI + camera sync stay consistent.
 */
export function generateBotVisit(
  state: GameState,
  difficulty: BotDifficulty,
  rng: Rng = defaultRng
): DartThrow[] {
  const darts: DartThrow[] = [];
  let cur = state;
  const startPlayer = cur.currentPlayerIndex;

  for (let i = 0; i < 3; i++) {
    if (cur.status !== "playing") break;
    if (cur.currentPlayerIndex !== startPlayer) break;
    const dart = generateNextBotDart(cur, difficulty, rng);
    if (!dart) break;
    darts.push(dart);
    const result = applyDart(cur, dart);
    cur = result.state;
    if (cur.currentPlayerIndex !== startPlayer || cur.status !== "playing") break;
  }

  return darts;
}

/** Convenience: difficulty from a player seat. */
export function generateNextBotDartForPlayer(
  state: GameState,
  rng: Rng = defaultRng
): DartThrow | null {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return null;
  return generateNextBotDart(state, resolveBotDifficulty(player), rng);
}
