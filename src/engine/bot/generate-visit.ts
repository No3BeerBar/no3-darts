/**
 * Bot visit / next-dart generation.
 *
 * Modes: X01 (full) + Cricket (natural). Other modes use a simple
 * target-hit path via `generateGenericBotDart` as an extension point.
 */

import { getCheckoutSuggestion } from "../checkout";
import { createDart } from "../dart";
import { applyDart, getRemaining } from "../engine";
import { baseballInning } from "../modes/baseball";
import { fortyOneTarget } from "../modes/forty-one";
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

function botDart(kind: SegmentKind, number: number): DartThrow {
  return createDart(kind, number, { source: "bot" });
}

function scoringAim(profile: BotProfile, remaining: number, rng: Rng): AimTarget {
  // Prefer not to leave awkward remainders when close but not on a finish.
  if (remaining > 60 && remaining <= 100 && rng() < 0.35) {
    // Set up — aim high single/treble of a round number
    return { kind: rng() < profile.trebleBias ? "triple" : "single", number: 20 };
  }
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
    // Must hit a double to open
    return resolveCheckoutAim({ kind: "double", number: 16 }, profile, rng);
  }

  // Bust avoidance: remaining < 2 after open with double-out impossible
  if (remaining <= 1) return botDart("miss", 0);

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
    // Setup dart on a multi-dart checkout — use aim accuracy
    return resolveAim(aim, profile, rng);
  }

  // Scoring visit — don't bust past remaining when close
  if (remaining <= 60) {
    // No checkout route (bogey / too few darts) — leave an even number if possible
    const aim = scoringAim(profile, remaining, rng);
    let dart = resolveAim(aim, profile, rng);
    // Soft bust guard: if this single dart exceeds remaining (double-out) or equals 1, miss
    if (doubleOut) {
      if (dart.value >= remaining) {
        // Try a safer single
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

  // Prefer highest unclosed number; if all closed, score on 20
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

  // Cricket uses cricketAccuracy as the hit gate
  if (rng() > profile.cricketAccuracy) {
    return resolveAim(aim, { ...profile, aimAccuracy: profile.cricketAccuracy * 0.5 }, rng);
  }
  return resolveAim(aim, { ...profile, aimAccuracy: Math.max(profile.cricketAccuracy, 0.7) }, rng);
}

/** Extension point for Baseball / 41 / Killer / other modes. */
export function generateGenericBotDart(
  state: GameState,
  profile: BotProfile,
  rng: Rng = defaultRng
): DartThrow {
  if (state.mode === "baseball") {
    const inning = baseballInning(state);
    return resolveAim(
      { kind: rng() < profile.trebleBias ? "triple" : "single", number: inning },
      profile,
      rng
    );
  }

  if (state.mode === "forty_one") {
    const t = fortyOneTarget(state);
    if (t.type === "number") {
      return resolveAim(
        { kind: rng() < profile.trebleBias ? "triple" : "single", number: t.n },
        profile,
        rng
      );
    }
    if (t.type === "any_double") {
      return resolveCheckoutAim({ kind: "double", number: 16 }, profile, rng);
    }
    if (t.type === "any_triple") {
      return resolveAim({ kind: "triple", number: 20 }, profile, rng);
    }
    if (t.type === "bull") {
      return resolveCheckoutAim({ kind: "bull" }, profile, rng);
    }
    // exact_41 — aim for a scoring combination; simple path: T20 / S20 / miss noise
    return resolveAim({ kind: "triple", number: 20 }, profile, rng);
  }

  if (state.mode === "killer") {
    const player = state.players[state.currentPlayerIndex];
    const ps = state.playerStates.find((p) => p.playerId === player?.id);
    const extra = ps ? getKillerExtra(ps) : null;
    if (extra && !extra.isKiller) {
      return resolveCheckoutAim({ kind: "double", number: extra.killerNumber }, profile, rng);
    }
    // Armed — try an opponent double
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

  // Shanghai / count-up / ATC / Bermuda / random checkout — score T20-ish
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

  // Default scoring aim
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

  if (state.mode === "x01") return x01NextDart(state, profile, rng);
  if (state.mode === "cricket") return cricketNextDart(state, profile, rng);
  return generateGenericBotDart(state, profile, rng);
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
