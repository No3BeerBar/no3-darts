import { getHandler, teamDisplayName, threeDartAverage } from "@/engine";
import type { GameState } from "@/engine/types";
import type { StoredMatch } from "./storage";

export function modeDisplayLabel(state: GameState): string {
  if (state.modeConfig.mode === "x01") {
    return `${state.modeConfig.config.startScore}`;
  }
  try {
    return getHandler(state.mode).displayName;
  } catch {
    return state.mode;
  }
}

/**
 * Guests (and bots) may play, but must not keep history / scores / leaderboard credit.
 * A match is recordable only when at least one non-guest PIN account played.
 * Bot seats are always `isGuest: true` — excluded here as a belt-and-suspenders check.
 */
export function hasRegisteredPlayers(match: Pick<StoredMatch, "players"> | GameState): boolean {
  return match.players.some((p) => p.isGuest !== true && !("isBot" in p && p.isBot));
}

export function buildStoredMatch(state: GameState): StoredMatch {
  const modeLabel = modeDisplayLabel(state);

  const winnerId = state.winnerId;
  const winnerName = winnerId
    ? teamDisplayName(state, state.winnerTeamId ?? winnerId)
    : null;

  return {
    id: state.id,
    finishedAt: Date.now(),
    mode: state.mode,
    modeLabel,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      isGuest: p.isGuest,
    })),
    winnerId,
    winnerName,
    state,
    summary: {
      legs: state.legNumber,
      sets: state.setNumber,
      // Only registered players keep stats — guests & bots are ephemeral
      playerStats: state.playerStates
        .filter((ps) => {
          const p = state.players.find((x) => x.id === ps.playerId);
          return p ? p.isGuest !== true && p.isBot !== true : false;
        })
        .map((ps) => {
          const name = state.players.find((p) => p.id === ps.playerId)?.name ?? "?";
          return {
            playerId: ps.playerId,
            name,
            avg: threeDartAverage(ps),
            oneEighties: ps.oneEighties,
            checkouts: ps.checkoutsHit,
            highestCheckout: ps.highestCheckout,
            /** Finishing score — used for Baseball / 41 high-score boards */
            finalScore: ps.score,
          };
        }),
    },
  };
}
