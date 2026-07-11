/**
 * Checkout suggestion engine for double-out X01.
 * Returns best-known routes for remaining scores ≤ 170.
 */

import type { CheckoutSuggestion, SegmentKind } from "./types";

type Step = { label: string; kind: SegmentKind; number: number; value: number };

function S(n: number): Step {
  return { label: `S${n}`, kind: "single", number: n, value: n };
}
function D(n: number): Step {
  return { label: `D${n}`, kind: "double", number: n, value: n * 2 };
}
function T(n: number): Step {
  return { label: `T${n}`, kind: "triple", number: n, value: n * 3 };
}
const BULL: Step = { label: "BULL", kind: "bull", number: 50, value: 50 };
const OB: Step = { label: "25", kind: "outer_bull", number: 25, value: 25 };

/** Hand-curated / algorithmically common preferred checkouts */
const PREFERRED: Record<number, Step[]> = {
  170: [T(20), T(20), BULL],
  167: [T(20), T(19), BULL],
  164: [T(20), T(18), BULL],
  161: [T(20), T(17), BULL],
  160: [T(20), T(20), D(20)],
  158: [T(20), T(20), D(19)],
  157: [T(20), T(19), D(20)],
  156: [T(20), T(20), D(18)],
  155: [T(20), T(19), D(19)],
  154: [T(20), T(18), D(20)],
  153: [T(20), T(19), D(18)],
  152: [T(20), T(20), D(16)],
  151: [T(20), T(17), D(20)],
  150: [T(20), T(18), D(18)],
  149: [T(20), T(19), D(16)],
  148: [T(20), T(20), D(14)],
  147: [T(20), T(17), D(18)],
  146: [T(20), T(18), D(16)],
  145: [T(20), T(15), D(20)],
  144: [T(20), T(20), D(12)],
  143: [T(20), T(17), D(16)],
  142: [T(20), T(14), D(20)],
  141: [T(20), T(19), D(12)],
  140: [T(20), T(20), D(10)],
  139: [T(20), T(13), D(20)],
  138: [T(20), T(18), D(12)],
  137: [T(20), T(19), D(10)],
  136: [T(20), T(20), D(8)],
  135: [T(20), T(17), D(12)],
  134: [T(20), T(14), D(16)],
  133: [T(20), T(19), D(8)],
  132: [T(20), T(16), D(12)],
  131: [T(20), T(13), D(16)],
  130: [T(20), T(20), D(5)],
  129: [T(19), T(16), D(12)],
  128: [T(18), T(14), D(20)],
  127: [T(20), T(17), D(8)],
  126: [T(19), T(19), D(6)],
  125: [T(20), T(15), D(10)],
  124: [T(20), T(16), D(8)],
  123: [T(19), T(16), D(9)],
  122: [T(18), T(18), D(7)],
  121: [T(20), T(11), D(14)],
  120: [T(20), S(20), D(20)],
  119: [T(19), T(12), D(13)],
  118: [T(20), S(18), D(20)],
  117: [T(20), S(17), D(20)],
  116: [T(20), S(16), D(20)],
  115: [T(20), S(15), D(20)],
  114: [T(20), S(14), D(20)],
  113: [T(20), S(13), D(20)],
  112: [T(20), S(12), D(20)],
  111: [T(20), S(11), D(20)],
  110: [T(20), S(10), D(20)],
  109: [T(20), S(9), D(20)],
  108: [T(20), S(16), D(16)],
  107: [T(19), S(10), D(20)],
  106: [T(20), S(6), D(20)],
  105: [T(20), S(13), D(16)],
  104: [T(18), S(18), D(16)],
  103: [T(19), S(6), D(20)],
  102: [T(20), S(10), D(16)],
  101: [T(17), S(10), D(20)],
  100: [T(20), D(20)],
  99: [T(19), S(10), D(16)],
  98: [T(20), D(19)],
  97: [T(19), D(20)],
  96: [T(20), D(18)],
  95: [T(19), D(19)],
  94: [T(18), D(20)],
  93: [T(19), D(18)],
  92: [T(20), D(16)],
  91: [T(17), D(20)],
  90: [T(18), D(18)],
  89: [T(19), D(16)],
  88: [T(20), D(14)],
  87: [T(17), D(18)],
  86: [T(18), D(16)],
  85: [T(15), D(20)],
  84: [T(20), D(12)],
  83: [T(17), D(16)],
  82: [BULL, D(16)],
  81: [T(19), D(12)],
  80: [T(20), D(10)],
  79: [T(13), D(20)],
  78: [T(18), D(12)],
  77: [T(19), D(10)],
  76: [T(20), D(8)],
  75: [T(17), D(12)],
  74: [T(14), D(16)],
  73: [T(19), D(8)],
  72: [T(16), D(12)],
  71: [T(13), D(16)],
  70: [T(18), D(8)],
  69: [T(19), D(6)],
  68: [T(20), D(4)],
  67: [T(17), D(8)],
  66: [T(10), D(18)],
  65: [T(19), D(4)],
  64: [T(16), D(8)],
  63: [T(13), D(12)],
  62: [T(10), D(16)],
  61: [T(15), D(8)],
  60: [S(20), D(20)],
  59: [S(19), D(20)],
  58: [S(18), D(20)],
  57: [S(17), D(20)],
  56: [S(16), D(20)],
  55: [S(15), D(20)],
  54: [S(14), D(20)],
  53: [S(13), D(20)],
  52: [S(12), D(20)],
  51: [S(11), D(20)],
  50: [BULL],
  49: [S(9), D(20)],
  48: [S(16), D(16)],
  47: [S(15), D(16)],
  46: [S(6), D(20)],
  45: [S(13), D(16)],
  44: [S(12), D(16)],
  43: [S(3), D(20)],
  42: [S(10), D(16)],
  41: [S(9), D(16)],
  40: [D(20)],
  39: [S(7), D(16)],
  38: [D(19)],
  37: [S(5), D(16)],
  36: [D(18)],
  35: [S(3), D(16)],
  34: [D(17)],
  33: [S(1), D(16)],
  32: [D(16)],
  31: [S(15), D(8)],
  30: [D(15)],
  29: [S(13), D(8)],
  28: [D(14)],
  27: [S(11), D(8)],
  26: [D(13)],
  25: [S(9), D(8)],
  24: [D(12)],
  23: [S(7), D(8)],
  22: [D(11)],
  21: [S(5), D(8)],
  20: [D(10)],
  19: [S(3), D(8)],
  18: [D(9)],
  17: [S(1), D(8)],
  16: [D(8)],
  15: [S(7), D(4)],
  14: [D(7)],
  13: [S(5), D(4)],
  12: [D(6)],
  11: [S(3), D(4)],
  10: [D(5)],
  9: [S(1), D(4)],
  8: [D(4)],
  7: [S(3), D(2)],
  6: [D(3)],
  5: [S(1), D(2)],
  4: [D(2)],
  3: [S(1), D(1)],
  2: [D(1)],
};

/** Bogey numbers that cannot be checked out in 3 darts (or at all for some) */
const NO_CHECKOUT = new Set([
  169, 168, 166, 165, 163, 162, 159,
]);

export function isCheckoutPossible(remaining: number, dartsLeft: number, doubleOut = true): boolean {
  if (!doubleOut) {
    return remaining > 0 && remaining <= 60 * dartsLeft && !(remaining === 0);
  }
  if (remaining < 2) return remaining === 0 ? false : remaining === 0;
  if (remaining === 0) return false;
  if (NO_CHECKOUT.has(remaining)) return false;
  if (remaining > 170) return false;
  if (dartsLeft <= 0) return false;
  if (dartsLeft === 1) {
    return remaining % 2 === 0 && remaining <= 40 || remaining === 50;
  }
  return PREFERRED[remaining] !== undefined || remaining <= 170;
}

export function getCheckoutSuggestion(
  remaining: number,
  dartsLeft = 3,
  doubleOut = true
): CheckoutSuggestion | null {
  if (!doubleOut) {
    // Straight out: dump high scores
    if (remaining <= 0 || remaining > 180) return null;
    const steps: Step[] = [];
    let left = remaining;
    let d = dartsLeft;
    while (left > 0 && d > 0) {
      if (d === 1) {
        if (left <= 20) steps.push(S(left));
        else if (left === 25) steps.push(OB);
        else if (left === 50) steps.push(BULL);
        else if (left <= 40 && left % 2 === 0) steps.push(D(left / 2));
        else if (left <= 60 && left % 3 === 0) steps.push(T(left / 3));
        else return null;
        left = 0;
      } else {
        if (left > 60) {
          steps.push(T(20));
          left -= 60;
        } else if (left > 40) {
          const t = Math.min(20, Math.floor(left / 3));
          steps.push(T(t));
          left -= t * 3;
        } else {
          steps.push(S(Math.min(20, left)));
          left -= Math.min(20, left);
        }
      }
      d--;
    }
    if (left !== 0) return null;
    return {
      remaining,
      darts: steps,
      description: steps.map((s) => s.label).join(" → "),
    };
  }

  if (remaining < 2 || remaining > 170 || NO_CHECKOUT.has(remaining)) return null;

  const preferred = PREFERRED[remaining];
  if (preferred && preferred.length <= dartsLeft) {
    return {
      remaining,
      darts: preferred,
      description: preferred.map((s) => s.label).join(" → "),
    };
  }

  // Fallback: try to leave a double
  if (dartsLeft >= 1 && remaining <= 40 && remaining % 2 === 0) {
    const d = D(remaining / 2);
    return { remaining, darts: [d], description: d.label };
  }
  if (remaining === 50 && dartsLeft >= 1) {
    return { remaining, darts: [BULL], description: "BULL" };
  }

  return preferred
    ? {
        remaining,
        darts: preferred,
        description: preferred.map((s) => s.label).join(" → "),
      }
    : null;
}

/** All finishable totals in one dart (double out) */
export function oneDartFinishes(): number[] {
  const out: number[] = [50];
  for (let i = 1; i <= 20; i++) out.push(i * 2);
  return out.sort((a, b) => a - b);
}
