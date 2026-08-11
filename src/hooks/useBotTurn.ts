"use client";

/**
 * Auto-play bot seats on `/play`.
 * When the current thrower is a bot, generate darts with a short delay
 * so the visit feels natural (not instant spam). Cancels on match abort /
 * player change / pause.
 */

import { useEffect, useRef } from "react";
import {
  generateNextBotDart,
  isBotPlayer,
  planBotTurn,
  resolveBotDifficulty,
} from "@/engine";
import { useGameStore } from "@/store/game-store";

export function useBotTurn(enabled = true) {
  const state = useGameStore((s) => s.state);
  const displayOnly = useGameStore((s) => s.displayOnly);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    clear();
    generationRef.current += 1;
    const gen = generationRef.current;

    if (!enabled || displayOnly) return clear;

    const plan = planBotTurn(state);
    if (plan.action === "idle") return clear;

    timerRef.current = setTimeout(() => {
      if (gen !== generationRef.current) return;
      const store = useGameStore.getState();
      const cur = store.state;
      if (!cur || store.displayOnly) return;
      const nextPlan = planBotTurn(cur);
      if (nextPlan.action !== "throw" || nextPlan.playerId !== plan.playerId) return;

      const thrower = cur.players[cur.currentPlayerIndex];
      if (!thrower) return;
      const dart = generateNextBotDart(cur, resolveBotDifficulty(thrower));
      if (!dart) return;
      store.throwDartObject(dart);
    }, plan.delayMs);

    return clear;
  }, [
    enabled,
    displayOnly,
    state?.id,
    state?.status,
    state?.currentPlayerIndex,
    state?.currentTurnDarts?.length,
    state?.updatedAt,
  ]);
}

/** True when the live thrower is a bot (UI disables board / camera collision). */
export function isCurrentThrowerBot(
  state: {
    status: string;
    players: Array<{ isBot?: boolean; botDifficulty?: import("@/engine").BotDifficulty }>;
    currentPlayerIndex: number;
  } | null
): boolean {
  if (!state || state.status !== "playing") return false;
  const p = state.players[state.currentPlayerIndex];
  return Boolean(p && isBotPlayer(p));
}
