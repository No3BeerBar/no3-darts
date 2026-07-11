import { teamDisplayName, threeDartAverage } from "@/engine";
import type { GameState } from "@/engine/types";
import type { StoredMatch } from "./storage";

export function buildStoredMatch(state: GameState): StoredMatch {
  const modeLabel =
    state.modeConfig.mode === "x01"
      ? `${state.modeConfig.config.startScore}`
      : state.mode;

  const winnerId = state.winnerId;
  const winnerName = winnerId
    ? teamDisplayName(state, state.winnerTeamId ?? winnerId)
    : null;

  return {
    id: state.id,
    finishedAt: Date.now(),
    mode: state.mode,
    modeLabel,
    players: state.players.map((p) => ({ id: p.id, name: p.name })),
    winnerId,
    winnerName,
    state,
    summary: {
      legs: state.legNumber,
      sets: state.setNumber,
      playerStats: state.playerStates.map((ps) => {
        const name = state.players.find((p) => p.id === ps.playerId)?.name ?? "?";
        return {
          playerId: ps.playerId,
          name,
          avg: threeDartAverage(ps),
          oneEighties: ps.oneEighties,
          checkouts: ps.checkoutsHit,
          highestCheckout: ps.highestCheckout,
        };
      }),
    },
  };
}
