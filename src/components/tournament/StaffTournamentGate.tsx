"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { PlayAdminPinModal } from "@/components/scoring/PlayAdminPinModal";
import { usePlayAdmin } from "@/hooks/usePlayAdmin";
import { useSettingsStore } from "@/store/settings-store";

/**
 * Tournament create / bracket / lane assign is staff-only.
 * Same PIN unlock as /play admin (Admin → Staff PIN / STAFF_PIN).
 */
function GateInner({ children }: { children: React.ReactNode }) {
  const settings = useSettingsStore();
  const admin = usePlayAdmin(settings.staffPin);

  useEffect(() => {
    settings.hydrate();
  }, [settings]);

  if (!admin.isAdmin) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <h1 className="font-logo text-2xl text-white">Tournament setup</h1>
        <p className="text-sm text-zinc-500">
          Staff only — enter the staff PIN to create brackets and assign Boards 1–3. Lane tablets
          do not need this for “Tournament match ready”.
        </p>
        <button type="button" className="btn-primary min-h-12 px-8" onClick={admin.openPin}>
          Staff unlock
        </button>
        <Link href="/admin" className="text-sm text-[var(--brand-red-bright)] underline">
          Back to Admin
        </Link>
        {admin.pinOpen && (
          <PlayAdminPinModal
            tryPin={admin.tryPin}
            onSuccess={admin.unlock}
            onClose={admin.closePin}
            title="Staff unlock"
            description="Enter staff PIN for tournament setup (same as Admin → Staff PIN)"
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mx-auto flex max-w-4xl items-center justify-end gap-2 px-4 pt-3">
        <span className="font-display text-[10px] tracking-wider text-emerald-500">Staff</span>
        <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={admin.lock}>
          Lock
        </button>
      </div>
      {children}
    </div>
  );
}

export function StaffTournamentGate({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-16 text-center text-zinc-500">Loading staff gate…</div>
      }
    >
      <GateInner>{children}</GateInner>
    </Suspense>
  );
}
