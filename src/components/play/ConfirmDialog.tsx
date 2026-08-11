"use client";

/**
 * In-app confirm for kiosk tablets.
 * Native `window.confirm` is unreliable on iPad / standalone (often no dialog,
 * false return) — End game / Cancel looked like a no-op in live QA.
 */

import { cn } from "@/lib/utils";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Keep playing",
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/85 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-2xl border border-[rgb(225_6_0/0.45)] bg-[#0a0a0a] p-5 shadow-2xl"
      >
        <h2 id="confirm-dialog-title" className="font-display text-lg tracking-wide text-white">
          {title}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">{message}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "btn-primary min-h-12 flex-1 px-4",
              danger && "bg-[var(--brand-red)] hover:bg-[var(--brand-red-bright)]"
            )}
          >
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancel} className="btn-ghost min-h-12 flex-1 px-4">
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
