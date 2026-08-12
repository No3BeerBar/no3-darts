"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BotDifficulty, GameModeId, ModeConfig, PlayerRef } from "@/engine";
import {
  BOT_DIFFICULTY_ORDER,
  BOT_PROFILES,
  buildTeamsFromDraft,
  createBotSeat,
  createId,
  getBotProfile,
  modeSupportsTeams,
  validateKillerNumbers,
} from "@/engine";
import { AuthModal, type AuthMode } from "@/components/auth/AuthModal";
import { SavedPlayersPicker } from "@/components/auth/SavedPlayersPicker";
import { ConfirmDialog } from "@/components/play/ConfirmDialog";
import { HowToPlayModal } from "@/components/play/HowToPlayModal";
import { TournamentMatchBanner } from "@/components/tournament/TournamentMatchBanner";
import { abandonMatchAction } from "@/lib/clear-active-match";
import { playHref } from "@/lib/play-kiosk";
import { seatsNeedingReauth } from "@/lib/seat-auth";
import { isOnTabletSession, isTabletSessionCold } from "@/lib/tablet-session";
import { cn } from "@/lib/utils";
import { useGameStore } from "@/store/game-store";
import { usePlayersStore } from "@/store/players-store";
import { useSessionStore } from "@/store/session-store";
import { useSettingsStore } from "@/store/settings-store";

const MODES: Array<{ id: GameModeId; name: string }> = [
  { id: "x01", name: "X01" },
  { id: "cricket", name: "Cricket" },
  { id: "shanghai", name: "Shanghai" },
  { id: "baseball", name: "Baseball" },
  { id: "forty_one", name: "41" },
  { id: "countup", name: "Count-Up" },
  { id: "around_the_clock", name: "Around Clock" },
  { id: "bermuda", name: "Bermuda" },
  { id: "random_checkout", name: "Checkout" },
  { id: "killer", name: "Killer" },
];

const MODE_BLURBS: Partial<Record<GameModeId, string>> = {
  baseball:
    "9 innings · only hits on the current inning number count (e.g. inning 4: S4/D4/T4 = 4/8/12) · anything else = 0 · highest total wins",
  killer:
    "Each player gets a unique number 1–20 · hit your double to become Killer · then hit their doubles to take lives · last life standing wins · only doubles count",
  forty_one:
    "Start at 60 · rounds: 20, 19, any double, 18, 17, any triple, 16, 15, exact 41 (all 3 darts must score — a miss voids even if sum is 41 — and total exactly 41), bull · hit the target to add · miss all → score halved (round up) · highest wins",
};

type PlayFormat = "singles" | "teams";

interface DraftTeam {
  key: string;
  name: string;
  /** 0–2 players */
  players: PlayerRef[];
}

function emptyTeam(n: number): DraftTeam {
  return { key: createId("draft"), name: `Team ${n}`, players: [] };
}

export function GameSetup() {
  const router = useRouter();
  const startGame = useGameStore((s) => s.startGame);
  const active = useGameStore((s) => s.state);
  const hydrateGame = useGameStore((s) => s.hydrate);
  const playersStore = usePlayersStore();
  const sessionPlayer = useSessionStore((s) => s.player);
  const tabletPlayers = useSessionStore((s) => s.tabletPlayers);
  const sessionDbConfigured = useSessionStore((s) => s.dbConfigured);
  const sessionDbAvailable = useSessionStore((s) => s.dbAvailable);
  const sessionHydrated = useSessionStore((s) => s.hydrated);
  const hydrateSession = useSessionStore((s) => s.hydrate);
  const logoutSession = useSessionStore((s) => s.logout);
  const rememberTabletPlayer = useSessionStore((s) => s.rememberTabletPlayer);
  const settings = useSettingsStore();

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authName, setAuthName] = useState("");
  const [pendingSelect, setPendingSelect] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const [mode, setMode] = useState<GameModeId>("x01");
  const [startScore, setStartScore] = useState<301 | 501 | 701 | 901>(501);
  const [doubleIn, setDoubleIn] = useState(false);
  const [doubleOut, setDoubleOut] = useState(true);
  const [cricketVariant, setCricketVariant] = useState<"standard" | "cutthroat">("standard");
  const [legsToWin, setLegsToWin] = useState(1);
  const [setsToWin, setSetsToWin] = useState(1);
  const [selected, setSelected] = useState<PlayerRef[]>([]);
  const [guestName, setGuestName] = useState("");
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("pub");
  const [countUpTurns, setCountUpTurns] = useState(8);
  const [killerLives, setKillerLives] = useState(3);
  const [killerNumbers, setKillerNumbers] = useState<Record<string, number>>({});
  /** Player currently picking a Killer number (tap board or chip). */
  const [killerPickPlayerId, setKillerPickPlayerId] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [playFormat, setPlayFormat] = useState<PlayFormat>("singles");
  const [draftTeams, setDraftTeams] = useState<DraftTeam[]>([emptyTeam(1), emptyTeam(2)]);
  /** Player waiting to be placed on a team */
  const [holding, setHolding] = useState<PlayerRef | null>(null);

  const teamsAllowed = modeSupportsTeams(mode);
  const isTeams = teamsAllowed && playFormat === "teams";

  useEffect(() => {
    hydrateGame();
    playersStore.hydrate();
    settings.hydrate();
    void hydrateSession();
  }, [hydrateGame, playersStore, settings, hydrateSession]);

  const openAuth = (mode: AuthMode, name = "", selectAfter = true) => {
    setAuthMode(mode);
    setAuthName(name);
    setPendingSelect(selectAfter);
    setAuthOpen(true);
  };

  const onAuthSuccess = (player: {
    id: string;
    name: string;
    createdAt: number;
    stats: {
      matchesPlayed: number;
      matchesWon: number;
      legsWon: number;
      dartsThrown: number;
      totalScore: number;
      oneEighties: number;
      checkoutsHit: number;
      checkoutAttempts: number;
      highestCheckout: number;
      bestThreeDartAvg: number;
    };
  }) => {
    playersStore.rememberRegistered(player);
    rememberTabletPlayer({ id: player.id, name: player.name });
    void playersStore.syncFromServer();
    void hydrateSession();
    if (pendingSelect) {
      togglePlayer({ id: player.id, name: player.name, isGuest: false });
    }
  };

  const pickSavedPlayer = (p: PlayerRef) => {
    const sessionId = sessionPlayer?.id;
    // Already PIN-trusted this tablet session → seat without re-PIN / picker hop
    if (
      playersStore.isRegistered(p.id) &&
      p.id !== sessionId &&
      !isOnTabletSession(p.id, tabletPlayers)
    ) {
      // Cold / new name → sign in (sticky) or unlock without stealing cookie
      openAuth(sessionId ? "unlock" : "signin", p.name, true);
      return;
    }
    togglePlayer(p);
  };

  const coldTablet = isTabletSessionCold(sessionPlayer?.id, tabletPlayers);

  /** All players currently assigned to any team */
  const assignedIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of draftTeams) for (const p of t.players) s.add(p.id);
    return s;
  }, [draftTeams]);

  const teamPlayerCount = draftTeams.reduce((n, t) => n + t.players.length, 0);

  const togglePlayer = (p: PlayerRef) => {
    if (isTeams) {
      // In team mode, tapping a free player picks them up for placement
      if (assignedIds.has(p.id)) return;
      setHolding((h) => (h?.id === p.id ? null : p));
      setSetupError(null);
      return;
    }
    setSelected((prev) => {
      if (prev.some((x) => x.id === p.id)) {
        setKillerNumbers((nums) => {
          const next = { ...nums };
          delete next[p.id];
          return next;
        });
        return prev.filter((x) => x.id !== p.id);
      }
      if (prev.length >= 8) return prev;
      return [...prev, p];
    });
    setSetupError(null);
  };

  const placeOnTeam = (teamKey: string) => {
    if (!holding) return;
    setDraftTeams((prev) =>
      prev.map((t) => {
        if (t.key !== teamKey) return t;
        if (t.players.length >= 2) return t;
        if (t.players.some((p) => p.id === holding.id)) return t;
        return { ...t, players: [...t.players, holding] };
      })
    );
    setHolding(null);
    setSetupError(null);
  };

  const removeFromTeam = (teamKey: string, playerId: string) => {
    setDraftTeams((prev) =>
      prev.map((t) =>
        t.key === teamKey
          ? { ...t, players: t.players.filter((p) => p.id !== playerId) }
          : t
      )
    );
  };

  const addTeam = () => {
    if (draftTeams.length >= 4) return; // 4 teams × 2 = 8 players max
    setDraftTeams((prev) => [...prev, emptyTeam(prev.length + 1)]);
  };

  const removeTeam = (teamKey: string) => {
    setDraftTeams((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((t) => t.key !== teamKey);
    });
  };

  const renameTeam = (teamKey: string, name: string) => {
    setDraftTeams((prev) =>
      prev.map((t) => (t.key === teamKey ? { ...t, name } : t))
    );
  };

  const assignKillerNumber = (playerId: string, num: number) => {
    setKillerNumbers((prev) => {
      const next = { ...prev };
      for (const [pid, n] of Object.entries(next)) {
        if (n === num && pid !== playerId) delete next[pid];
      }
      next[playerId] = num;
      const order = selected.map((p) => p.id);
      const nextMissing = order.find((id) => next[id] == null);
      setKillerPickPlayerId(nextMissing ?? playerId);
      return next;
    });
    setSetupError(null);
  };

  const autoAssignKillerNumbers = () => {
    const pool = Array.from({ length: 20 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const next: Record<string, number> = {};
    selected.forEach((p, i) => {
      next[p.id] = pool[i];
    });
    setKillerNumbers(next);
    setKillerPickPlayerId(selected[0]?.id ?? null);
    setSetupError(null);
  };

  const addGuest = () => {
    const name = guestName.trim() || `Guest ${Date.now() % 100}`;
    const g: PlayerRef = { id: createId("guest"), name, isGuest: true };
    if (isTeams) {
      setHolding(g);
    } else {
      setSelected((prev) => (prev.length >= 8 ? prev : [...prev, g]));
    }
    setGuestName("");
  };

  const addBot = (difficulty: BotDifficulty = botDifficulty) => {
    const bot = createBotSeat(difficulty, () => createId("bot"));
    if (isTeams) {
      setHolding(bot);
    } else {
      setSelected((prev) => (prev.length >= 8 ? prev : [...prev, bot]));
    }
    // Killer: auto-pick a free number for the new bot seat
    if (mode === "killer" && !isTeams) {
      const used = new Set(Object.values(killerNumbers));
      const free = Array.from({ length: 20 }, (_, i) => i + 1).find((n) => !used.has(n));
      if (free != null) {
        setKillerNumbers((prev) => ({ ...prev, [bot.id]: free }));
      }
    }
  };

  const buildConfig = (): ModeConfig => {
    switch (mode) {
      case "x01":
        return { mode: "x01", config: { startScore, doubleIn, doubleOut } };
      case "cricket":
        return { mode: "cricket", config: { variant: cricketVariant } };
      case "shanghai":
        return { mode: "shanghai", config: { maxRound: 20 } };
      case "countup":
        return { mode: "countup", config: { turns: countUpTurns } };
      case "around_the_clock":
        return {
          mode: "around_the_clock",
          config: { direction: "up", requireDouble: false, includeBull: true },
        };
      case "bermuda":
        return { mode: "bermuda", config: {} };
      case "random_checkout":
        return { mode: "random_checkout", config: { minScore: 41, maxScore: 170, attempts: 10 } };
      case "killer":
        return {
          mode: "killer",
          config: { lives: killerLives, playerNumbers: killerNumbers, doublesOnly: true },
        };
      case "baseball":
        return { mode: "baseball", config: { innings: 9 } };
      case "forty_one":
        return { mode: "forty_one", config: {} };
    }
  };

  const onStart = () => {
    if (mode === "killer") {
      if (selected.length < 2) return;
      const err = validateKillerNumbers(selected, killerNumbers);
      if (err) {
        setSetupError(err);
        return;
      }
    }

    try {
      if (isTeams) {
        const filled = draftTeams.filter((t) => t.players.length > 0);
        if (filled.length < 2) {
          setSetupError("Add at least 2 teams with players");
          return;
        }
        if (filled.some((t) => t.players.length < 1)) {
          setSetupError("Every team needs at least one player");
          return;
        }
        const { teams, players } = buildTeamsFromDraft(
          filled.map((t) => ({ name: t.name, players: t.players }))
        );
        startGame({
          modeConfig: buildConfig(),
          players,
          teams,
          matchFormat: { legsToWin, setsToWin },
          roomId: settings.roomName,
        });
      } else {
        if (selected.length < 1) return;
        startGame({
          modeConfig: buildConfig(),
          players: selected,
          matchFormat:
            mode === "killer" ? { legsToWin: 1, setsToWin: 1 } : { legsToWin, setsToWin },
          roomId: settings.roomName,
        });
      }
      router.push(playHref(settings.roomName));
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : "Could not start match");
    }
  };

  const onCancelMatch = () => {
    const live = useGameStore.getState().state;
    if (!live) return;
    // In-app confirm — window.confirm is a no-op on some iPad kiosk WebViews
    if (abandonMatchAction(live) === "confirm") {
      setCancelConfirmOpen(true);
      return;
    }
    useGameStore.getState().setDisplayOnly(false);
    useGameStore.getState().clearGame();
  };

  const confirmCancelMatch = () => {
    setCancelConfirmOpen(false);
    useGameStore.getState().setDisplayOnly(false);
    useGameStore.getState().clearGame();
  };

  const hasActive =
    active &&
    (active.status === "playing" ||
      active.status === "paused" ||
      active.status === "leg_won" ||
      active.status === "match_won");

  const resumeNeedsPin =
    hasActive &&
    seatsNeedingReauth(active!.id, active!.players, sessionPlayer?.id ?? null).length > 0;

  const canStart = isTeams
    ? draftTeams.filter((t) => t.players.length > 0).length >= 2 &&
      draftTeams.every((t) => t.players.length === 0 || t.players.length >= 1)
    : selected.length >= (mode === "killer" ? 2 : 1);

  return (
    <div className="space-y-3">
      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Cancel this match?"
        message="Scores will not be saved. Resume will disappear from this tablet."
        confirmLabel="Cancel match"
        cancelLabel="Keep match"
        onConfirm={confirmCancelMatch}
        onCancel={() => setCancelConfirmOpen(false)}
      />
      <AuthModal
        open={authOpen}
        mode={authMode}
        initialName={authName}
        onClose={() => setAuthOpen(false)}
        onSuccess={onAuthSuccess}
      />

      <HowToPlayModal
        open={howToPlayOpen}
        mode={mode}
        onClose={() => setHowToPlayOpen(false)}
      />

      <SavedPlayersPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        sessionPlayerId={sessionPlayer?.id ?? null}
        selectedIds={
          isTeams
            ? [...assignedIds]
            : selected.map((p) => p.id)
        }
        onCreateAccount={() => openAuth("register", "", true)}
        onPick={(p) => {
          if (!isTeams) {
            const on = selected.some((s) => s.id === p.id);
            if (on) {
              togglePlayer({ id: p.id, name: p.name, isGuest: false });
              return;
            }
          }
          pickSavedPlayer({ id: p.id, name: p.name, isGuest: false });
        }}
      />

      {!hasActive && <TournamentMatchBanner />}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-3 py-2">
        {sessionPlayer ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">
                Signed in · {sessionPlayer.name}
              </div>
              <div className="text-[11px] text-zinc-500">
                Stats sync across tablets
                {sessionPlayer.stats.matchesPlayed > 0
                  ? ` · ${sessionPlayer.stats.matchesPlayed} matches`
                  : ""}
              </div>
            </div>
            <button
              type="button"
              className="btn-ghost min-h-10 text-xs"
              onClick={() => {
                if (isTeams) {
                  pickSavedPlayer({
                    id: sessionPlayer.id,
                    name: sessionPlayer.name,
                    isGuest: false,
                  });
                  return;
                }
                if (!selected.some((s) => s.id === sessionPlayer.id)) {
                  togglePlayer({
                    id: sessionPlayer.id,
                    name: sessionPlayer.name,
                    isGuest: false,
                  });
                }
              }}
            >
              Add me
            </button>
            <button
              type="button"
              className="btn-primary min-h-10 text-xs"
              onClick={() => setPickerOpen(true)}
            >
              Saved players
            </button>
            <button
              type="button"
              className="btn-ghost min-h-10 text-xs text-zinc-400"
              onClick={() => void logoutSession()}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1 text-xs text-zinc-500">
              {sessionDbConfigured && !sessionDbAvailable
                ? "Accounts offline — guests still work"
                : "Saved players · PIN · or play as guest"}
            </div>
            <button
              type="button"
              className="btn-primary min-h-10 text-xs"
              onClick={() => setPickerOpen(true)}
              disabled={sessionHydrated && sessionDbConfigured && !sessionDbAvailable}
            >
              Saved players
            </button>
            <button
              type="button"
              className="btn-ghost min-h-10 text-xs"
              onClick={() => openAuth("register")}
              disabled={sessionHydrated && sessionDbConfigured && !sessionDbAvailable}
            >
              Create account
            </button>
          </>
        )}
      </div>

      {hasActive && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[rgb(225_6_0/0.4)] bg-[rgb(225_6_0/0.1)] p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-sm text-white">
              {active!.players.map((p) => p.name).join(" · ")}
            </div>
            <div className="text-xs text-zinc-500">
              {active!.mode}
              {resumeNeedsPin ? " · PIN required to resume" : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push(playHref(settings.roomName))}
            className="btn-primary min-h-11"
          >
            Resume
          </button>
          <button type="button" onClick={onCancelMatch} className="btn-ghost min-h-11 text-red-300">
            Cancel
          </button>
        </div>
      )}

      <section>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title mb-0">Mode</h2>
          <button
            type="button"
            onClick={() => setHowToPlayOpen(true)}
            className="btn-ghost min-h-10 px-3 font-display text-xs tracking-wider text-zinc-300"
          >
            How to play
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                if (!modeSupportsTeams(m.id)) setPlayFormat("singles");
              }}
              className={cn("chip min-h-10 px-3 py-1.5 text-xs", mode === m.id && "chip-active")}
            >
              {m.name}
            </button>
          ))}
        </div>
        {MODE_BLURBS[mode] && (
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{MODE_BLURBS[mode]}</p>
        )}
      </section>

      {teamsAllowed && (
        <section>
          <h2 className="section-title mb-1.5">Format</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPlayFormat("singles");
                setHolding(null);
              }}
              className={cn("chip min-h-10", playFormat === "singles" && "chip-active")}
            >
              Singles
            </button>
            <button
              type="button"
              onClick={() => {
                setPlayFormat("teams");
                setHolding(null);
                setSelected([]);
              }}
              className={cn("chip min-h-10", playFormat === "teams" && "chip-active")}
            >
              Teams
            </button>
          </div>
          {isTeams && (
            <p className="mt-1.5 text-xs text-zinc-500">
              Up to 2 players per team · 2–4 teams · shared score · personal stats
            </p>
          )}
        </section>
      )}

      {mode === "x01" && (
        <div className="flex flex-wrap items-center gap-2">
          {([301, 501, 701, 901] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStartScore(s)}
              className={cn("chip min-h-10", startScore === s && "chip-active")}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDoubleIn((v) => !v)}
            className={cn("chip min-h-10", doubleIn && "chip-active")}
          >
            DI
          </button>
          <button
            type="button"
            onClick={() => setDoubleOut((v) => !v)}
            className={cn("chip min-h-10", doubleOut && "chip-active")}
          >
            DO
          </button>
        </div>
      )}

      {mode === "cricket" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCricketVariant("standard")}
            className={cn("chip min-h-10", cricketVariant === "standard" && "chip-active")}
          >
            Standard
          </button>
          <button
            type="button"
            onClick={() => setCricketVariant("cutthroat")}
            className={cn("chip min-h-10", cricketVariant === "cutthroat" && "chip-active")}
          >
            Cut-throat
          </button>
        </div>
      )}

      {mode === "countup" && (
        <div className="flex flex-wrap gap-2">
          {[5, 8, 10, 15].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setCountUpTurns(t)}
              className={cn("chip min-h-10", countUpTurns === t && "chip-active")}
            >
              {t} turns
            </button>
          ))}
        </div>
      )}

      {mode === "killer" && (
        <div className="space-y-3 rounded-xl border border-zinc-800 p-3">
          <p className="text-xs leading-relaxed text-zinc-400">
            Optional: claim numbers by throwing with your{" "}
            <span className="font-semibold text-zinc-200">weak hand</span> — first
            unique double (or tap below) locks your number.
          </p>
          <div className="flex flex-wrap gap-2">
            {[3, 5, 7].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setKillerLives(n)}
                className={cn("chip min-h-10", killerLives === n && "chip-active")}
              >
                {n} lives
              </button>
            ))}
            <button type="button" className="btn-ghost min-h-10 text-xs" onClick={autoAssignKillerNumbers}>
              Auto #s
            </button>
          </div>

          {selected.length === 0 ? (
            <p className="text-xs text-zinc-600">Add at least 2 players, then pick numbers.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {selected.map((p) => {
                  const active =
                    (killerPickPlayerId ?? selected.find((x) => killerNumbers[x.id] == null)?.id) ===
                    p.id;
                  const num = killerNumbers[p.id];
                  const botBadge = p.isBot
                    ? getBotProfile(p.botDifficulty ?? "pub").badge
                    : null;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setKillerPickPlayerId(p.id)}
                      className={cn(
                        "min-h-11 rounded-xl border px-3 py-2 text-left transition",
                        active
                          ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.14)]"
                          : "border-[var(--panel-border)] bg-[var(--panel)]"
                      )}
                    >
                      <div className="truncate text-sm font-semibold text-zinc-100">
                        {p.name}
                        {botBadge && (
                          <span className="ml-1.5 align-middle text-[9px] font-bold tracking-wider text-[var(--brand-red-bright)]">
                            BOT · {botBadge}
                          </span>
                        )}
                      </div>
                      <div className="font-display text-xs tracking-wider text-zinc-500">
                        {num ? `D${num}` : "TAP #"}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div>
                <div className="mb-1.5 font-display text-[10px] tracking-[0.2em] text-zinc-600">
                  TAP A NUMBER
                  {(() => {
                    const pid =
                      killerPickPlayerId ??
                      selected.find((x) => killerNumbers[x.id] == null)?.id ??
                      selected[0]?.id;
                    const name = selected.find((p) => p.id === pid)?.name;
                    return name ? ` · ${name.toUpperCase()}` : "";
                  })()}
                </div>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => {
                    const ownerId = Object.entries(killerNumbers).find(([, num]) => num === n)?.[0];
                    const pickId =
                      killerPickPlayerId ??
                      selected.find((x) => killerNumbers[x.id] == null)?.id ??
                      selected[0]?.id;
                    const mine = ownerId === pickId;
                    const taken = Boolean(ownerId) && !mine;
                    return (
                      <button
                        key={n}
                        type="button"
                        disabled={taken || !pickId}
                        onClick={() => pickId && assignKillerNumber(pickId, n)}
                        className={cn(
                          "min-h-11 rounded-lg font-black tabular-nums transition",
                          mine && "bg-[var(--brand-red)] text-white",
                          !mine && !taken && "border border-[var(--panel-border)] bg-black text-zinc-200",
                          taken && "cursor-not-allowed bg-zinc-900 text-zinc-700 opacity-50"
                        )}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {mode !== "killer" && (
        <div className="flex flex-wrap gap-2">
          <span className="self-center font-display text-[10px] tracking-wider text-zinc-500">
            Legs
          </span>
          {[1, 2, 3].map((n) => (
            <button
              key={`l${n}`}
              type="button"
              onClick={() => setLegsToWin(n)}
              className={cn("chip min-h-10 px-3", legsToWin === n && "chip-active")}
            >
              {n}
            </button>
          ))}
          <span className="self-center font-display text-[10px] tracking-wider text-zinc-500">
            Sets
          </span>
          {[1, 2, 3].map((n) => (
            <button
              key={`s${n}`}
              type="button"
              onClick={() => setSetsToWin(n)}
              className={cn("chip min-h-10 px-3", setsToWin === n && "chip-active")}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {/* ——— TEAMS BUILDER ——— */}
      {isTeams ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="section-title">Teams ({teamPlayerCount} players)</h2>
            {holding && (
              <button
                type="button"
                className="btn-ghost min-h-9 text-xs"
                onClick={() => setHolding(null)}
              >
                Cancel pick
              </button>
            )}
          </div>

          {holding && (
            <div className="rounded-xl border border-[var(--brand-red)] bg-[rgb(225_6_0/0.12)] px-3 py-2 text-center text-sm">
              Place <strong className="text-[var(--brand-red-bright)]">{holding.name}</strong> — tap a
              team below
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {draftTeams.map((team, ti) => (
              <div
                key={team.key}
                className={cn(
                  "rounded-2xl border p-3 transition",
                  holding && team.players.length < 2
                    ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.08)]"
                    : "border-[var(--panel-border)] bg-[var(--panel)]"
                )}
              >
                <label className="mb-2 block">
                  <span className="mb-1 block font-display text-[10px] tracking-wider text-zinc-500">
                    Team name
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      className="input min-h-12 flex-1 py-2 text-base font-bold"
                      value={team.name}
                      onChange={(e) => renameTeam(team.key, e.target.value)}
                      placeholder={`Team ${ti + 1}`}
                      maxLength={32}
                    />
                    {draftTeams.length > 2 && (
                      <button
                        type="button"
                        className="btn-ghost min-h-12 px-2 text-xs text-zinc-500"
                        onClick={() => removeTeam(team.key)}
                        aria-label="Remove team"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </label>

                {/* Two clear slots */}
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1].map((slot) => {
                    const p = team.players[slot];
                    if (p) {
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => removeFromTeam(team.key, p.id)}
                          className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-[rgb(225_6_0/0.4)] bg-[rgb(225_6_0/0.12)] px-2 py-2"
                        >
                          <span className="text-[10px] text-zinc-500">
                            {slot === 0 ? "Player 1" : "Partner"}
                          </span>
                          <span className="truncate text-sm font-bold text-white">{p.name}</span>
                          <span className="text-[10px] text-zinc-600">tap to remove</span>
                        </button>
                      );
                    }
                    const canDrop = holding && team.players.length < 2;
                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={!canDrop}
                        onClick={() => placeOnTeam(team.key)}
                        className={cn(
                          "flex min-h-14 flex-col items-center justify-center rounded-xl border border-dashed px-2 py-2",
                          canDrop
                            ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.06)] text-[var(--brand-red-bright)]"
                            : "border-zinc-700 text-zinc-600"
                        )}
                      >
                        <span className="text-[10px] uppercase tracking-wider">
                          {slot === 0 ? "Player 1" : "Partner"}
                        </span>
                        <span className="text-sm font-semibold">
                          {canDrop ? "Tap to add" : "Empty"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {draftTeams.length < 4 && (
            <button type="button" onClick={addTeam} className="btn-ghost min-h-11 w-full">
              + Add team
            </button>
          )}

          <div className="space-y-2">
            <h3 className="section-title">
              {holding
                ? `Holding ${holding.name} — tap a team slot`
                : "Add players to teams"}
            </h3>
            {holding && (
              <button
                type="button"
                className="btn-ghost min-h-11 w-full text-xs"
                onClick={() => setHolding(null)}
              >
                Cancel pick · {holding.name}
              </button>
            )}
            {/* Warm session: quick-seat PIN-trusted names; cold: picker only */}
            {!coldTablet && tabletPlayers.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {tabletPlayers
                  .filter((p) => !assignedIds.has(p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        pickSavedPlayer({ id: p.id, name: p.name, isGuest: false })
                      }
                      className={cn(
                        "min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-semibold",
                        holding?.id === p.id
                          ? "border-[var(--brand-red)] bg-[var(--brand-red)] text-white"
                          : "border-[var(--panel-border)] bg-[var(--panel)]"
                      )}
                    >
                      {p.name}
                      <span className="mt-0.5 block text-[10px] font-normal text-zinc-500">
                        {sessionPlayer?.id === p.id ? "You" : "Signed in"}
                      </span>
                    </button>
                  ))}
              </div>
            )}
            <button
              type="button"
              className={cn(
                "min-h-12 w-full",
                coldTablet ? "btn-primary" : "btn-ghost"
              )}
              onClick={() => setPickerOpen(true)}
            >
              Saved players
            </button>
            {coldTablet && (
              <p className="text-center text-xs text-zinc-600">
                Search the directory · enter PIN — or add a guest below.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Guest name"
              className="input min-h-11 min-w-[8rem] flex-1"
              onKeyDown={(e) => e.key === "Enter" && addGuest()}
            />
            <button type="button" onClick={addGuest} className="btn-ghost min-h-11 shrink-0">
              + Guest
            </button>
            <button
              type="button"
              className="btn-ghost min-h-11 shrink-0"
              onClick={() => openAuth("register")}
            >
              Create account
            </button>
          </div>

          <div className="mt-3 rounded-xl border border-[var(--panel-border)] bg-[#050505] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-[10px] tracking-[0.2em] text-zinc-500">
                BOT OPPONENT
              </h3>
              <button
                type="button"
                onClick={() => addBot()}
                className="btn-ghost min-h-10 shrink-0 px-3 text-xs"
              >
                + {BOT_PROFILES[botDifficulty].displayName}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {BOT_DIFFICULTY_ORDER.map((id) => {
                const profile = BOT_PROFILES[id];
                const elite = id === "luke_littler";
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBotDifficulty(id)}
                    className={cn(
                      "chip min-h-10 px-2.5 text-xs",
                      botDifficulty === id && "chip-active",
                      elite && botDifficulty === id && "border-[var(--brand-red)]"
                    )}
                  >
                    {profile.displayName}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">
              Bots throw automatically · no PIN · no stats. Hardest: Luke Littler.
            </p>
          </div>
        </section>
      ) : (
        /* ——— SINGLES / KILLER player pick ——— */
        <section>
          <h2 className="section-title mb-1.5">
            Players {selected.length > 0 ? `(${selected.length})` : ""}
          </h2>
          {selected.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selected.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePlayer(p)}
                  className="chip chip-active min-h-10 px-3"
                >
                  {i + 1}. {p.name}
                  {p.isBot && (
                    <span className="ml-1 text-[9px] tracking-wider text-[var(--brand-red-bright)]">
                      BOT
                    </span>
                  )}{" "}
                  ×
                </button>
              ))}
            </div>
          )}
          {/* Warm: show signed-in names for one-tap seat. Cold: picker only (no 50+ dump). */}
          {!coldTablet && tabletPlayers.length > 0 && (
            <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {tabletPlayers.map((p) => {
                const on = selected.some((s) => s.id === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      if (on) {
                        togglePlayer({ id: p.id, name: p.name, isGuest: false });
                        return;
                      }
                      pickSavedPlayer({ id: p.id, name: p.name, isGuest: false });
                    }}
                    className={cn(
                      "min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-semibold",
                      on
                        ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.2)]"
                        : "border-[var(--panel-border)] bg-[var(--panel)]"
                    )}
                  >
                    {p.name}
                    <span className="mt-0.5 block text-[10px] font-normal text-zinc-500">
                      {sessionPlayer?.id === p.id ? "You" : "Signed in"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className={cn("mb-2 min-h-12 w-full", coldTablet ? "btn-primary" : "btn-ghost")}
            onClick={() => setPickerOpen(true)}
          >
            Saved players
          </button>
          <p className="mb-2 text-xs text-zinc-600">
            {coldTablet
              ? "Search the directory · enter PIN — or add a guest below."
              : "Tap a signed-in name to seat them · Saved players for everyone else."}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Guest name"
              className="input min-h-11 min-w-[8rem] flex-1"
              onKeyDown={(e) => e.key === "Enter" && addGuest()}
            />
            <button type="button" onClick={addGuest} className="btn-ghost min-h-11 shrink-0">
              + Guest
            </button>
            <button
              type="button"
              className="btn-ghost min-h-11 shrink-0"
              onClick={() => openAuth("register", "", true)}
            >
              Create account
            </button>
          </div>

          <div className="mt-3 rounded-xl border border-[var(--panel-border)] bg-[#050505] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-[10px] tracking-[0.2em] text-zinc-500">
                BOT OPPONENT
              </h3>
              <button
                type="button"
                onClick={() => addBot()}
                className="btn-ghost min-h-10 shrink-0 px-3 text-xs"
              >
                + {BOT_PROFILES[botDifficulty].displayName}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {BOT_DIFFICULTY_ORDER.map((id) => {
                const profile = BOT_PROFILES[id];
                const elite = id === "luke_littler";
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBotDifficulty(id)}
                    className={cn(
                      "chip min-h-10 px-2.5 text-xs",
                      botDifficulty === id && "chip-active",
                      elite && botDifficulty === id && "border-[var(--brand-red)]"
                    )}
                  >
                    {profile.displayName}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">
              Bots throw automatically · no PIN · no stats. Hardest: Luke Littler.
            </p>
          </div>
        </section>
      )}

      {setupError && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {setupError}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.replace(playHref(settings.roomName))}
            className="btn-ghost min-h-14 flex-1 px-4 font-display text-base tracking-wider text-red-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canStart}
            onClick={onStart}
            className="btn-primary min-h-14 flex-[2] text-lg disabled:opacity-40"
          >
            Start {isTeams ? "team match" : "match"}
          </button>
        </div>
        {!canStart && (
          <p className="text-center text-xs text-zinc-500">
            {isTeams
              ? "Add at least 2 teams with players to start"
              : mode === "killer"
                ? "Add at least 2 players to start"
                : "Add at least one player to start"}
          </p>
        )}
      </div>
    </div>
  );
}
