"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { playHref, setupHref } from "@/lib/play-kiosk";
import { useSettingsStore } from "@/store/settings-store";

/**
 * Optional `?room=Board%201` sets this tablet's lane name.
 * On setup `/` and idle/scoring `/play`, keep `room` in the URL so Board 1
 * stays Board 1 across hops (query is the kiosk bookmark contract).
 */
export function RoomQuerySync() {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const update = useSettingsStore((s) => s.update);
  const hydrate = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    const fromQuery = search.get("room")?.trim();
    if (fromQuery) {
      update({ roomName: fromQuery });
      return;
    }

    const stored = useSettingsStore.getState().roomName?.trim();
    if (!stored) return;
    if (pathname === "/play") {
      router.replace(playHref(stored));
    } else if (pathname === "/") {
      router.replace(setupHref(stored));
    }
  }, [search, update, hydrate, pathname, router]);

  return null;
}
