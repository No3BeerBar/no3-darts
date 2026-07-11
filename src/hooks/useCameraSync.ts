"use client";

/**
 * Pull camera-scored darts from the server into the tablet game.
 * Uses SSE + polling (Railway SSE can drop; poll is reliable).
 */

import { useEffect, useRef } from "react";
import type { GameState } from "@/engine/types";
import { useGameStore } from "@/store/game-store";

function isAhead(remote: GameState, local: GameState): boolean {
  if (remote.id !== local.id) return false;
  if ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) return true;
  if ((remote.updatedAt ?? 0) < (local.updatedAt ?? 0)) return false;
  // same timestamp — more darts in the current visit wins
  const rTurn = remote.currentTurnDarts?.length ?? 0;
  const lTurn = local.currentTurnDarts?.length ?? 0;
  if (rTurn > lTurn) return true;
  const rThrown = (remote.playerStates ?? []).reduce(
    (a, p) => a + (p.dartsThrown ?? 0),
    0
  );
  const lThrown = (local.playerStates ?? []).reduce(
    (a, p) => a + (p.dartsThrown ?? 0),
    0
  );
  return rThrown > lThrown;
}

function applyRemote(remote: GameState, callout?: string) {
  const cur = useGameStore.getState().state;
  if (!cur || !isAhead(remote, cur)) return false;
  // localOnly: write localStorage + UI, but do not re-POST and fight the server
  useGameStore.getState().setState(remote, { localOnly: true });
  if (callout) {
    useGameStore.setState({ lastCallout: callout });
  }
  return true;
}

export function useCameraSync(enabled = true) {
  const matchId = useGameStore((s) => s.state?.id);
  const roomId = useGameStore((s) => s.state?.roomId);
  const status = useGameStore((s) => s.state?.status);
  const displayOnly = useGameStore((s) => s.displayOnly);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || displayOnly || !matchId) return;
    if (status !== "playing" && status !== "paused") return;

    let cancelled = false;
    const room = roomId || "Board 1";

    const poll = async () => {
      if (cancelled) return;
      try {
        const r = await fetch(
          `/api/matches/active?room=${encodeURIComponent(room)}&_=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const data = (await r.json()) as { match?: GameState };
        if (data.match && data.match.id === matchId) {
          applyRemote(data.match);
        }
      } catch {
        /* offline */
      }
    };

    const connectSse = () => {
      try {
        esRef.current?.close();
      } catch {
        /* */
      }
      try {
        const es = new EventSource(`/api/camera/stream?_=${Date.now()}`);
        esRef.current = es;

        es.addEventListener("dart_detected", (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as {
              state?: GameState;
              callout?: string;
            };
            if (data.state) applyRemote(data.state, data.callout);
          } catch {
            /* */
          }
        });

        es.addEventListener("match_update", (ev) => {
          try {
            const state = JSON.parse((ev as MessageEvent).data) as GameState;
            applyRemote(state);
          } catch {
            /* */
          }
        });

        es.onerror = () => {
          try {
            es.close();
          } catch {
            /* */
          }
          esRef.current = null;
          if (!cancelled) {
            window.setTimeout(connectSse, 2000);
          }
        };
      } catch {
        if (!cancelled) window.setTimeout(connectSse, 3000);
      }
    };

    // Immediate + frequent poll so camera darts show within ~1s even without SSE
    void poll();
    const pollId = window.setInterval(poll, 1000);
    connectSse();

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      try {
        esRef.current?.close();
      } catch {
        /* */
      }
      esRef.current = null;
    };
  }, [enabled, displayOnly, matchId, roomId, status]);
}
