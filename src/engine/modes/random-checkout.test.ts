import { describe, expect, it } from "vitest";
import {
  applyDart,
  createDart,
  createGame,
  defaultModeConfig,
  type ModeConfig,
  type RandomCheckoutConfig,
  type X01Config,
} from "@/engine";

const BOGEYS = [169, 168, 166, 165, 163, 162, 159];
const TABLET_CHECKOUT = { minScore: 41, maxScore: 170, attempts: 10 } as const;

const players = [
  { id: "A", name: "A", isGuest: true },
  { id: "B", name: "B", isGuest: true },
];

/** API payloads may send `{}` or omit config; createGame fills from defaults. */
type IncompleteModeConfig =
  | { mode: "random_checkout"; config?: Partial<RandomCheckoutConfig> }
  | { mode: "x01"; config?: Partial<X01Config> };

function createGameFromApi(modeConfig: IncompleteModeConfig) {
  return createGame({
    modeConfig: modeConfig as ModeConfig,
    players,
  });
}

function assertPlayableLeave(score: number) {
  expect(Number.isInteger(score)).toBe(true);
  expect(Number.isNaN(score)).toBe(false);
  expect(score).toBeGreaterThanOrEqual(2);
  expect(score).toBeLessThanOrEqual(170);
  expect(BOGEYS).not.toContain(score);
}

function assertPlayableCheckoutMatch(
  state: ReturnType<typeof createGame>,
  expectedConfig = TABLET_CHECKOUT
) {
  expect(state.mode).toBe("random_checkout");
  expect(state.modeConfig).toEqual({
    mode: "random_checkout",
    config: expectedConfig,
  });
  expect(state.playerStates).toHaveLength(2);
  for (const ps of state.playerStates) {
    assertPlayableLeave(ps.score);
    expect(ps.extra?.attemptsLeft).toBe(10);
  }
}

describe("random checkout — empty / missing API config", () => {
  it("createGame with empty config starts a playable match", () => {
    const state = createGameFromApi({
      mode: "random_checkout",
      config: {},
    });
    assertPlayableCheckoutMatch(state);
  });

  it("createGame with omitted config starts a playable match", () => {
    const state = createGameFromApi({
      mode: "random_checkout",
    });
    assertPlayableCheckoutMatch(state);
  });

  it("tablet-shaped config is stored unchanged", () => {
    const config = { minScore: 41, maxScore: 170, attempts: 10 };
    const state = createGame({
      modeConfig: { mode: "random_checkout", config },
      players,
    });
    expect(state.modeConfig.config).toEqual(config);
    expect(state.modeConfig.config).toEqual(defaultModeConfig("random_checkout").config);
    assertPlayableCheckoutMatch(state, config);
  });
});

describe("random checkout — bust and checkout", () => {
  it("first-dart bust keeps the leave and advances the seat", () => {
    const state = createGame({
      modeConfig: { mode: "random_checkout", config: { minScore: 18, maxScore: 18, attempts: 10 } },
      players,
    });
    expect(state.playerStates[0].score).toBe(18);
    expect(state.currentPlayerIndex).toBe(0);

    const result = applyDart(state, createDart("triple", 20));
    expect(result.callout).toMatch(/BUST/i);
    expect(result.events.some((e) => e.type === "bust")).toBe(true);

    const turn = result.state.turns.at(-1);
    expect(turn).toMatchObject({
      playerId: "A",
      bust: true,
      checkout: false,
      startScore: 18,
      endScore: 18,
    });
    expect(result.state.playerStates[0].score).toBe(18);
    expect(result.state.currentPlayerIndex).toBe(1);
    expect(result.state.playerStates[0].extra?.attemptsLeft).toBe(9);
  });

  it("double-out checkout counts the attempt", () => {
    const state = createGame({
      modeConfig: { mode: "random_checkout", config: { minScore: 40, maxScore: 40, attempts: 10 } },
      players,
    });
    expect(state.playerStates[0].score).toBe(40);

    const result = applyDart(state, createDart("double", 20));
    expect(result.callout).toMatch(/CHECKOUT/i);

    const turn = result.state.turns.at(-1);
    expect(turn).toMatchObject({
      playerId: "A",
      bust: false,
      checkout: true,
      endScore: 0,
    });
    expect(result.state.playerStates[0].checkoutsHit).toBe(1);
    expect(result.state.playerStates[0].checkoutAttempts).toBe(1);
    expect(result.state.playerStates[0].extra?.attemptsLeft).toBe(9);
    expect(result.state.playerStates[0].extra?.attemptsDone).toBe(1);
    expect(result.state.currentPlayerIndex).toBe(1);
  });
});

describe("x01 — empty config uses bar defaults", () => {
  it("fills startScore 501 when config is empty", () => {
    const state = createGameFromApi({
      mode: "x01",
      config: {},
    });
    expect(state.modeConfig.config).toEqual({
      startScore: 501,
      doubleIn: false,
      doubleOut: true,
    });
    expect(state.playerStates[0].score).toBe(501);
    expect(state.playerStates[1].score).toBe(501);
  });
});
