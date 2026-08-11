"use client";

import { useEffect, useState } from "react";
import { PinPad } from "@/components/auth/PinPad";

export function PlayAdminPinModal({
  onSuccess,
  onClose,
  tryPin,
  title = "Staff unlock",
  description = "Enter staff PIN for Undo / Edit / pad",
}: {
  tryPin: (pin: string) => boolean;
  onSuccess: () => void;
  onClose: () => void;
  title?: string;
  description?: string;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (pin.length < 4) return;
    if (tryPin(pin)) {
      onSuccess();
      return;
    }
    setError(true);
    setPin("");
  }, [pin, tryPin, onSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] p-5">
        <h2 className="font-logo text-xl text-white">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
        {error && (
          <p className="mt-2 text-sm text-[var(--brand-red-bright)]">Wrong PIN</p>
        )}
        <div className="mt-4">
          <PinPad value={pin} onChange={setPin} />
        </div>
        <button
          type="button"
          className="btn-ghost mt-4 w-full min-h-11"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
