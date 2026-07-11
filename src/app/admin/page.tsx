"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/store/settings-store";
import { useGameStore } from "@/store/game-store";

export default function AdminPage() {
  const settings = useSettingsStore();
  const clearGame = useGameStore((s) => s.clearGame);

  useEffect(() => {
    settings.hydrate();
  }, [settings]);

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <div>
        <h1 className="font-logo text-3xl text-white">Admin</h1>
        <p className="mt-1 text-zinc-500">Bar staff · TV + iPad · room branding</p>
      </div>

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
            <strong className="text-white">iPad</strong> — open this site, start a match, use{" "}
            <a className="text-[var(--brand-red-bright)] underline" href="/play">
              /play
            </a>{" "}
            to score &amp; correct darts.
          </li>
          <li>
            Set the same <strong className="text-white">Room / board name</strong> below on both
            devices (default Board 1).
          </li>
          <li>
            <strong className="text-white">Fix a dart</strong> — tap the dart box on the iPad, pick
            the real segment. Or Undo / Edit visit.
          </li>
        </ol>
      </section>

      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
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
          <span className="font-semibold">Kiosk / TV mode flag</span>
          <input
            type="checkbox"
            checked={settings.kioskMode}
            onChange={(e) => settings.update({ kioskMode: e.target.checked })}
            className="h-5 w-5 accent-[var(--brand-red)]"
          />
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="section-title">DIY camera detection (not Autodarts)</h2>
        <p className="text-sm text-zinc-400">
          Run our OpenCV detector from the <code className="text-[var(--brand-red)]">detection/</code> folder
          on a PC next to the board. It posts hits here. Auth via{" "}
          <code className="text-[var(--brand-red)]">CAMERA_API_KEY</code> when set.
        </p>
        <ul className="space-y-2 font-mono text-sm text-zinc-300">
          <li className="rounded-lg bg-zinc-950 px-3 py-2">POST /api/camera/dart</li>
          <li className="rounded-lg bg-zinc-950 px-3 py-2">GET /api/camera/stream (SSE)</li>
          <li className="rounded-lg bg-zinc-950 px-3 py-2">GET /api/matches/active</li>
          <li className="rounded-lg bg-zinc-950 px-3 py-2">POST /api/matches/:id/dart</li>
        </ul>
        <p className="text-xs text-zinc-500">
          Setup: <code>cd detection && pip install -r requirements.txt && python -m no3_detect run</code>
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
