"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useSettingsStore } from "@/store/settings-store";

/** Optional `?room=Board%201` sets this tablet's lane name. */
export function RoomQuerySync() {
  const search = useSearchParams();
  const update = useSettingsStore((s) => s.update);
  const hydrate = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    const room = search.get("room");
    if (room?.trim()) {
      update({ roomName: room.trim() });
    }
  }, [search, update, hydrate]);

  return null;
}
