/**
 * Kiosk helpers for the patron play flow (setup `/` + scoring `/play`).
 *
 * Secondary screens (e.g. leaderboard) opened from play use `?from=play&back=…`
 * so AppShell can show Back + idle-return without the full site nav.
 *
 * Board tablets bookmark `/play?room=Board%201` — keep `room` on setup/play hops
 * so lane identity is not lost when starting a game.
 */

import type { GameState } from "@/engine";

export const PLAY_FROM_PARAM = "from";
export const PLAY_FROM_VALUE = "play";
export const PLAY_BACK_PARAM = "back";
export const ROOM_QUERY_PARAM = "room";

/** Idle play landing (no match) — setup Cancel / End game return here. */
export const PLAY_IDLE_HREF = "/play";

/** Idle on secondary screens before returning to play (~45–60s). */
export const PLAY_SECONDARY_IDLE_MS = 50_000;

/** Bare path back to setup or play (before optional ?room=). */
export type PlayBackPath = "/" | "/play";

/** Sanitized href back to setup or play; may include `?room=…`. */
export type PlayBackHref = string;

export function isPlayBackPath(value: string | null | undefined): boolean {
  if (!value) return false;
  const path = value.split("?")[0];
  return path === "/" || path === "/play";
}

/** Append/replace `room` on a path. Empty room → path unchanged. */
export function withRoomQuery(path: string, room?: string | null): string {
  const base = path.split("?")[0] || path;
  const trimmed = room?.trim();
  if (!trimmed) return base;
  const params = new URLSearchParams();
  params.set(ROOM_QUERY_PARAM, trimmed);
  return `${base}?${params.toString()}`;
}

export function playHref(room?: string | null): string {
  return withRoomQuery(PLAY_IDLE_HREF, room);
}

export function setupHref(room?: string | null): string {
  return withRoomQuery("/", room);
}

/**
 * Only `/` or `/play`, optionally with a single `room` query.
 * Strips any other query keys from untrusted `back` params.
 */
export function sanitizePlayBack(
  value: string | null | undefined,
): PlayBackHref {
  if (!value || !isPlayBackPath(value)) return "/";
  const path = (value.split("?")[0] || "/") as PlayBackPath;
  const qs = value.includes("?") ? value.slice(value.indexOf("?") + 1) : "";
  if (!qs) return path;
  const room = new URLSearchParams(qs).get(ROOM_QUERY_PARAM)?.trim();
  return room ? withRoomQuery(path, room) : path;
}

/** Leaderboard link from setup or scoring — marks the visit as from-play. */
export function statsHrefFromPlay(
  back: PlayBackPath,
  room?: string | null,
): string {
  const q = new URLSearchParams({
    [PLAY_FROM_PARAM]: PLAY_FROM_VALUE,
    [PLAY_BACK_PARAM]: withRoomQuery(back, room),
  });
  return `/leaderboard?${q.toString()}`;
}

export function isFromPlaySearch(
  get: (key: string) => string | null,
):
  | { fromPlay: true; back: PlayBackHref }
  | { fromPlay: false; back: PlayBackHref } {
  const fromPlay = get(PLAY_FROM_PARAM) === PLAY_FROM_VALUE;
  const back = sanitizePlayBack(get(PLAY_BACK_PARAM));
  return fromPlay ? { fromPlay: true, back } : { fromPlay: false, back: "/" };
}

/** True once any dart / completed visit / later leg exists — used for End game confirm. */
export function matchScoringStarted(state: GameState): boolean {
  if (state.currentTurnDarts.length > 0) return true;
  if (state.turns.length > 0) return true;
  if (state.legNumber > 1 || state.setNumber > 1) return true;
  if (state.status === "leg_won" || state.status === "match_won") return true;
  return state.playerStates.some((p) => (p.dartsThrown ?? 0) > 0);
}
