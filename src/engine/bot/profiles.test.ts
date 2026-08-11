import { describe, expect, it } from "vitest";
import {
  BOT_DIFFICULTY_ORDER,
  BOT_PROFILES,
  createBotSeat,
  getBotProfile,
  isBotPlayer,
} from "./profiles";

describe("bot difficulty profiles", () => {
  it("orders easiest → hardest with Luke Littler last", () => {
    expect(BOT_DIFFICULTY_ORDER[BOT_DIFFICULTY_ORDER.length - 1]).toBe("luke_littler");
    expect(BOT_DIFFICULTY_ORDER.length).toBeGreaterThanOrEqual(4);
    expect(BOT_DIFFICULTY_ORDER.length).toBeLessThanOrEqual(6);
  });

  it('names the hardest bot exactly "Luke Littler"', () => {
    expect(BOT_PROFILES.luke_littler.displayName).toBe("Luke Littler");
    expect(getBotProfile("luke_littler").displayName).toBe("Luke Littler");
  });

  it("creates seats as guests with isBot (no PIN / no stats credit)", () => {
    const seat = createBotSeat("luke_littler", () => "bot_1");
    expect(seat).toEqual({
      id: "bot_1",
      name: "Luke Littler",
      isGuest: true,
      isBot: true,
      botDifficulty: "luke_littler",
    });
    expect(isBotPlayer(seat)).toBe(true);
  });

  it("skill ladder: Luke Littler beats Pro on aim / checkout / average", () => {
    const pro = BOT_PROFILES.pro;
    const luke = BOT_PROFILES.luke_littler;
    expect(luke.aimAccuracy).toBeGreaterThan(pro.aimAccuracy);
    expect(luke.checkoutSkill).toBeGreaterThan(pro.checkoutSkill);
    expect(luke.scoringAvg).toBeGreaterThan(pro.scoringAvg);
    expect(luke.trebleBias).toBeGreaterThan(pro.trebleBias);

    // Rookie is weakest
    const rookie = BOT_PROFILES.rookie;
    expect(rookie.aimAccuracy).toBeLessThan(BOT_PROFILES.pub.aimAccuracy);
    expect(rookie.checkoutSkill).toBeLessThan(BOT_PROFILES.league.checkoutSkill);
  });
});
