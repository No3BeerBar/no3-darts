"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ResetPlayerPinPanel } from "@/components/admin/ResetPlayerPinPanel";
import { useSettingsStore } from "@/store/settings-store";
import { useGameStore } from "@/store/game-store";

export default function AdminPage() {
  const settings = useSettingsStore();
  const clearGame = useGameStore((s) => s.clearGame);
  const [dbStatus, setDbStatus] = useState<{
    configured: boolean;
    available: boolean;
  } | null>(null);

  useEffect(() => {
    settings.hydrate();
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/health")
      .then((r) => r.json())
      .then((data: { database?: { configured?: boolean; available?: boolean } }) => {
        if (cancelled) return;
        setDbStatus({
          configured: Boolean(data.database?.configured),
          available: Boolean(data.database?.available),
        });
      })
      .catch(() => {
        if (!cancelled) setDbStatus({ configured: false, available: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <div>
        <h1 className="font-logo text-3xl text-white">Admin</h1>
        <p className="mt-1 text-zinc-500">Bar staff · TV + iPad · room branding</p>
      </div>

      <section className="panel-card space-y-3 p-6">
        <h2 className="section-title">Tournament (staff)</h2>
        <p className="text-sm text-zinc-400">
          Single-elim nights that take over Board 1–3. Create / start / assign lanes here — not
          from the patron Play kiosk. Lane tablets still show “Tournament match ready” when you
          assign a match.
        </p>
        <Link href="/tournament" className="btn-primary inline-flex min-h-11 items-center px-5">
          Open tournament setup
        </Link>
        <p className="text-xs text-zinc-500">
          Requires staff PIN unlock (same as /play admin). See{" "}
          <code className="text-zinc-400">docs/TOURNAMENT.md</code>.
        </p>
      </section>

      <section className="panel-card space-y-3 p-6">
        <h2 className="section-title">Player accounts (Postgres)</h2>
        <p className="text-sm text-zinc-400">
          Walk-up name + PIN accounts need{" "}
          <code className="text-[var(--brand-red-bright)]">DATABASE_URL</code> on the Railway{" "}
          <strong className="text-white">no3-darts</strong> service (reference the Postgres plugin).
          See <code className="text-zinc-300">docs/PLAYERS.md</code>.
        </p>
        <div className="rounded-xl border border-[var(--panel-border)] bg-black px-4 py-3 text-sm">
          {dbStatus === null ? (
            <span className="text-zinc-500">Checking database…</span>
          ) : dbStatus.available ? (
            <span className="text-emerald-400">Database available — PIN accounts enabled</span>
          ) : dbStatus.configured ? (
            <span className="text-amber-300">
              DATABASE_URL is set but Postgres is unreachable — guests still work
            </span>
          ) : (
            <span className="text-amber-300">
              DATABASE_URL not configured — guests + localStorage only
            </span>
          )}
        </div>
      </section>

      <ResetPlayerPinPanel />

      <section className="panel-card space-y-3 p-6">
        <h2 className="section-title">Devices at the board</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          <li>
            <strong className="text-white">Mini PC → TV (HDMI)</strong> — open{" "}
            <a className="text-[var(--brand-red-bright)] underline" href="/tv">
              /tv
            </a>{" "}
            full screen (F11). Read-only scoreboard.
          </li>
          <li>
            <strong className="text-white">iPad (patrons)</strong> —{" "}
            <a className="text-[var(--brand-red-bright)] underline" href="/play">
              /play
            </a>{" "}
            is a clean scoring UI (scores, thrower, board, tap-to-correct). Staff tools are hidden.
          </li>
          <li>
            <strong className="text-white">Staff on play</strong> — unlock Undo / Edit / End /
            Pause / Cancel / Keys / Pad via long-press logo + PIN, Admin link, or{" "}
            <a className="text-[var(--brand-red-bright)] underline" href="/play?admin=1">
              /play?admin=1
            </a>
            . See <code className="text-zinc-300">docs/PLAY.md</code>.
          </li>
          <li>
            Set the same <strong className="text-white">Room / board name</strong> below on both
            devices (default Board 1).
          </li>
          <li>
            <strong className="text-white">Fix a dart</strong> — patrons tap the dart box and pick
            the real segment. Staff can also Undo / Edit visit when unlocked.
          </li>
        </ol>
      </section>

      <section className="panel-card space-y-4 p-6">
        <label className="block">
          <span className="section-title">Bar name</span>
          <input
            className="input mt-2 w-full"
            value={settings.barName}
            onChange={(e) => settings.update({ barName: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="section-title">Room / board name</span>
          <input
            className="input mt-2 w-full"
            value={settings.roomName}
            onChange={(e) => settings.update({ roomName: e.target.value })}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {(["Board 1", "Board 2", "Board 3"] as const).map((lane) => (
              <button
                key={lane}
                type="button"
                className="btn-ghost min-h-9 px-3 text-xs"
                onClick={() => settings.update({ roomName: lane })}
              >
                {lane}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Tournament mode uses these three lanes. Setup is staff-only via{" "}
            <Link href="/tournament" className="text-[var(--brand-red-bright)] underline">
              Tournament setup
            </Link>
            .
          </p>
        </label>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 px-4 py-3">
          <span className="font-semibold">Sound effects</span>
          <input
            type="checkbox"
            checked={settings.soundEnabled}
            onChange={(e) => settings.update({ soundEnabled: e.target.checked })}
            className="h-5 w-5 accent-[var(--brand-red)]"
          />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 px-4 py-3">
          <span className="font-semibold">Voice callouts</span>
          <input
            type="checkbox"
            checked={settings.voiceEnabled}
            onChange={(e) => settings.update({ voiceEnabled: e.target.checked })}
            className="h-5 w-5 accent-[var(--brand-red)]"
          />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <span className="font-semibold">Kiosk mode</span>
            <p className="mt-0.5 text-xs text-zinc-500">
              Hide site-wide nav everywhere (setup/play/TV already hide it; Stats uses
              Back + idle return). Staff: /admin or long-press logo on /play.
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.kioskMode}
            onChange={(e) => settings.update({ kioskMode: e.target.checked })}
            className="h-5 w-5 shrink-0 accent-[var(--brand-red)]"
          />
        </label>
        <label className="block">
          <span className="section-title">Staff PIN (unlock /play admin)</span>
          <input
            className="input mt-2 w-full font-mono tracking-widest"
            inputMode="numeric"
            maxLength={4}
            placeholder="1234"
            value={settings.staffPin}
            onChange={(e) =>
              settings.update({
                staffPin: e.target.value.replace(/\D/g, "").slice(0, 4),
              })
            }
          />
          <p className="mt-1 text-xs text-zinc-500">
            4 digits · default 1234 · unlocks /play staff tools and tournament setup (this
            browser). Server APIs (PIN reset, tournament create/start/assign) use{" "}
            <code className="text-zinc-400">STAFF_PIN</code> env — keep them matched or mutations
            return 401.
          </p>
        </label>
      </section>

      <section className="panel-card space-y-3 p-6">
        <h2 className="section-title">Throw detection (Autodarts → No3)</h2>
        <p className="text-sm text-zinc-400">
          Recommended: Autodarts Board Manager detects throws; the companion bridge on the board PC
          posts them here. Game modes stay in No3. Auth via{" "}
          <code className="text-[var(--brand-red)]">CAMERA_API_KEY</code> when set.
        </p>
        <ul className="space-y-2 font-mono text-sm text-zinc-300">
          <li className="rounded-lg border border-[var(--panel-border)] bg-black px-3 py-2">
            POST /api/camera/dart
          </li>
          <li className="rounded-lg border border-[var(--panel-border)] bg-black px-3 py-2">
            POST /api/camera/end-turn
          </li>
          <li className="rounded-lg border border-[var(--panel-border)] bg-black px-3 py-2">
            GET /api/camera/stream (SSE)
          </li>
          <li className="rounded-lg border border-[var(--panel-border)] bg-black px-3 py-2">
            GET /api/matches/active
          </li>
        </ul>
        <p className="text-xs text-zinc-500">
          Setup:{" "}
          <code>
            cd tools/autodarts-companion && python -m companion bridge
          </code>
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-red-900/40 bg-red-950/20 p-6">
        <h2 className="section-title text-red-400">Danger zone</h2>
        <button type="button" className="btn-ghost border-red-800 text-red-300" onClick={clearGame}>
          Clear active match
        </button>
      </section>
    </div>
  );
}
