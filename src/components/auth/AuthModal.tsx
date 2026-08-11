"use client";

import { useEffect, useState } from "react";
import { PinPad } from "@/components/auth/PinPad";
import { useSessionStore, type SessionPlayer } from "@/store/session-store";
import { cn } from "@/lib/utils";

export type AuthMode = "signin" | "register" | "unlock";

interface AuthModalProps {
  open: boolean;
  mode: AuthMode;
  /** Pre-fill / lock name when unlocking a listed player */
  initialName?: string;
  onClose: () => void;
  onSuccess: (player: SessionPlayer) => void;
}

export function AuthModal({ open, mode, initialName = "", onClose, onSuccess }: AuthModalProps) {
  const setSessionPlayer = useSessionStore((s) => s.setPlayer);
  const [name, setName] = useState(initialName);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"name" | "pin" | "confirm">("name");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setPin("");
    setConfirmPin("");
    setError(null);
    setBusy(false);
    // Prefill → jump to PIN (unlock, or sign-in from a listed player)
    if ((mode === "unlock" || mode === "signin") && initialName) setStep("pin");
    else setStep("name");
  }, [open, mode, initialName]);

  if (!open) return null;

  const title =
    mode === "register" ? "Create account" : mode === "unlock" ? "Enter PIN" : "Sign in";

  const submit = async (pinToUse: string) => {
    if (pinToUse.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      // Unlock with no tablet session → login so the player stays signed in
      // across end-game → next-game (verify alone never sets the cookie).
      const sessionEmpty = !useSessionStore.getState().player;
      const establishSession =
        mode === "signin" || mode === "register" || (mode === "unlock" && sessionEmpty);
      const path =
        mode === "register"
          ? "/api/auth/register"
          : establishSession
            ? "/api/auth/login"
            : "/api/auth/verify";
      const res = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pin: pinToUse }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        player?: SessionPlayer;
      };
      if (!data.ok || !data.player) {
        setError(data.error ?? "Something went wrong");
        setPin("");
        setConfirmPin("");
        setStep("pin");
        setBusy(false);
        return;
      }
      if (establishSession) {
        setSessionPlayer(data.player);
      } else {
        // Unlock another seat — keep cookie, still count as tablet-signed for quick re-add
        useSessionStore.getState().rememberTabletPlayer({
          id: data.player.id,
          name: data.player.name,
        });
      }
      onSuccess(data.player);
      onClose();
    } catch {
      setError("Network error — try again");
      setBusy(false);
    }
  };

  const onPinComplete = (next: string) => {
    setPin(next);
    if (next.length < 4) return;
    if (mode === "register") {
      setStep("confirm");
      return;
    }
    void submit(next);
  };

  const onConfirmComplete = (next: string) => {
    setConfirmPin(next);
    if (next.length < 4) return;
    if (next !== pin) {
      setError("PINs do not match");
      setPin("");
      setConfirmPin("");
      setStep("pin");
      return;
    }
    void submit(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-lg tracking-wide text-white">{title}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {mode === "register"
                ? "Display name + 4-digit PIN · stats follow you across tablets"
                : "Name + PIN · stays signed in on this tablet"}
            </p>
          </div>
          <button type="button" className="btn-ghost min-h-10 px-3" onClick={onClose}>
            ✕
          </button>
        </div>

        {step === "name" && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block font-display text-[10px] tracking-wider text-zinc-500">
                Display name
              </span>
              <input
                className="input min-h-12 w-full text-base"
                value={name}
                autoFocus
                maxLength={24}
                placeholder="e.g. Mike"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim().length >= 2) setStep("pin");
                }}
              />
            </label>
            <button
              type="button"
              className="btn-primary min-h-12 w-full"
              disabled={name.trim().length < 2}
              onClick={() => setStep("pin")}
            >
              Next — enter PIN
            </button>
          </div>
        )}

        {step === "pin" && (
          <div className="space-y-3">
            <div className="text-center text-sm text-zinc-300">
              PIN for <strong className="text-white">{name.trim()}</strong>
            </div>
            <PinPad value={pin} onChange={onPinComplete} disabled={busy} />
            {mode !== "unlock" && (
              <button
                type="button"
                className="btn-ghost min-h-10 w-full text-xs"
                onClick={() => {
                  setPin("");
                  setStep("name");
                }}
              >
                Change name
              </button>
            )}
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-3">
            <div className="text-center text-sm text-zinc-300">Confirm PIN</div>
            <PinPad value={confirmPin} onChange={onConfirmComplete} disabled={busy} />
          </div>
        )}

        {error && (
          <div
            className={cn(
              "mt-3 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200"
            )}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
