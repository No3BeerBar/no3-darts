"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PinPad } from "@/components/auth/PinPad";

type ListedPlayer = { id: string; name: string };

type Step = "list" | "set-pin" | "staff" | "confirm" | "done";

function randomTempPin(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

export function ResetPlayerPinPanel() {
  const [players, setPlayers] = useState<ListedPlayer[]>([]);
  const [dbAvailable, setDbAvailable] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ListedPlayer | null>(null);
  const [step, setStep] = useState<Step>("list");
  const [newPin, setNewPin] = useState("");
  const [staffPin, setStaffPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toldPin, setToldPin] = useState<string | null>(null);

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/players");
      const data = (await res.json()) as {
        ok?: boolean;
        players?: ListedPlayer[];
        dbAvailable?: boolean;
      };
      setPlayers(
        (data.players ?? []).map((p) => ({ id: p.id, name: p.name }))
      );
      setDbAvailable(Boolean(data.dbAvailable));
    } catch {
      setPlayers([]);
      setDbAvailable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlayers();
  }, [loadPlayers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => p.name.toLowerCase().includes(q));
  }, [players, query]);

  const closeFlow = () => {
    setSelected(null);
    setStep("list");
    setNewPin("");
    setStaffPin("");
    setError(null);
    setBusy(false);
    setToldPin(null);
  };

  const startReset = (player: ListedPlayer) => {
    setSelected(player);
    setNewPin("");
    setStaffPin("");
    setError(null);
    setToldPin(null);
    setStep("set-pin");
  };

  const submitReset = async () => {
    if (!selected || newPin.length !== 4 || staffPin.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/players/reset-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: selected.id,
          newPin,
          staffPin,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Reset failed");
        setStaffPin("");
        setBusy(false);
        if (res.status === 401) setStep("staff");
        return;
      }
      setToldPin(newPin);
      setStep("done");
      setBusy(false);
    } catch {
      setError("Network error — try again");
      setBusy(false);
    }
  };

  return (
    <section className="panel-card space-y-4 p-6">
      <div>
        <h2 className="section-title">Reset player PIN</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Forgotten PIN? Search a registered player, set a temporary PIN, and tell them the
          digits. Guests have no PIN. Each reset asks for the staff PIN (same as /play unlock;
          set below or via <code className="text-zinc-300">STAFF_PIN</code> on the server).
        </p>
      </div>

      {dbAvailable === false && (
        <p className="rounded-xl border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          Database unavailable — PIN reset needs Postgres.
        </p>
      )}

      <label className="block">
        <span className="sr-only">Search players</span>
        <input
          className="input w-full"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading || dbAvailable === false}
        />
      </label>

      <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-[var(--panel-border)] bg-black p-2">
        {loading ? (
          <p className="px-2 py-3 text-sm text-zinc-500">Loading players…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-sm text-zinc-500">
            {players.length === 0 ? "No registered players yet" : "No matches"}
          </p>
        ) : (
          filtered.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-zinc-900"
            >
              <span className="truncate font-semibold text-white">{p.name}</span>
              <button
                type="button"
                className="btn-ghost shrink-0 border-[var(--brand-red)]/40 px-3 py-1.5 text-sm text-[var(--brand-red-bright)]"
                onClick={() => startReset(p)}
                disabled={dbAvailable === false}
              >
                Reset PIN
              </button>
            </div>
          ))
        )}
      </div>

      {selected && step !== "list" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] p-5">
            {step === "set-pin" && (
              <>
                <h3 className="font-logo text-xl text-white">New PIN for {selected.name}</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Enter a temporary 4-digit PIN (or generate one). Tell the player after reset.
                </p>
                <div className="mt-4">
                  <PinPad value={newPin} onChange={setNewPin} disabled={busy} />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn-ghost flex-1"
                    onClick={() => setNewPin(randomTempPin())}
                    disabled={busy}
                  >
                    Generate
                  </button>
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    disabled={newPin.length !== 4 || busy}
                    onClick={() => {
                      setError(null);
                      setStaffPin("");
                      setStep("staff");
                    }}
                  >
                    Next
                  </button>
                </div>
                <button type="button" className="btn-ghost mt-2 w-full" onClick={closeFlow}>
                  Cancel
                </button>
              </>
            )}

            {step === "staff" && (
              <>
                <h3 className="font-logo text-xl text-white">Staff PIN</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Confirm you are staff before resetting {selected.name}&apos;s PIN.
                </p>
                {error && (
                  <p className="mt-2 text-sm text-[var(--brand-red-bright)]">{error}</p>
                )}
                <div className="mt-4">
                  <PinPad value={staffPin} onChange={setStaffPin} disabled={busy} />
                </div>
                <button
                  type="button"
                  className="btn-primary mt-4 w-full"
                  disabled={staffPin.length !== 4 || busy}
                  onClick={() => {
                    setError(null);
                    setStep("confirm");
                  }}
                >
                  Next
                </button>
                <button
                  type="button"
                  className="btn-ghost mt-2 w-full"
                  onClick={() => {
                    setStaffPin("");
                    setError(null);
                    setStep("set-pin");
                  }}
                >
                  Back
                </button>
              </>
            )}

            {step === "confirm" && (
              <>
                <h3 className="font-logo text-xl text-white">Confirm reset</h3>
                <p className="mt-2 text-sm text-zinc-300">
                  Reset PIN for <strong className="text-white">{selected.name}</strong>? Their old
                  PIN will stop working immediately.
                </p>
                <p className="mt-3 rounded-xl border border-[var(--panel-border)] bg-black px-4 py-3 text-center font-mono text-2xl tracking-[0.35em] text-[var(--brand-red-bright)]">
                  {newPin}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Write this down to tell the player. It is not stored in plaintext on the server.
                </p>
                {error && (
                  <p className="mt-2 text-sm text-[var(--brand-red-bright)]">{error}</p>
                )}
                <button
                  type="button"
                  className="btn-primary mt-4 w-full"
                  disabled={busy}
                  onClick={() => void submitReset()}
                >
                  {busy ? "Resetting…" : "Reset PIN"}
                </button>
                <button
                  type="button"
                  className="btn-ghost mt-2 w-full"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setStep("staff");
                  }}
                >
                  Back
                </button>
              </>
            )}

            {step === "done" && toldPin && (
              <>
                <h3 className="font-logo text-xl text-white">PIN reset</h3>
                <p className="mt-2 text-sm text-zinc-300">
                  Tell <strong className="text-white">{selected.name}</strong> their temporary PIN:
                </p>
                <p className="mt-3 rounded-xl border border-[var(--brand-red)]/50 bg-black px-4 py-3 text-center font-mono text-3xl tracking-[0.35em] text-[var(--brand-red-bright)]">
                  {toldPin}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Players cannot change their own PIN yet — staff can reset again anytime from Admin.
                </p>
                <button type="button" className="btn-primary mt-4 w-full" onClick={closeFlow}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
