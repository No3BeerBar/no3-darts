"use client";

/**
 * Searchable saved-player directory for setup / idle play.
 * Designed for 50–200 PIN accounts: type-ahead filter + scroll, then PIN.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { filterPlayersByName } from "@/lib/filter-players";
import { cn } from "@/lib/utils";
import { usePlayersStore } from "@/store/players-store";

export type SavedPlayerPick = { id: string; name: string };

interface SavedPlayersPickerProps {
  open: boolean;
  onClose: () => void;
  /** Called after the patron taps a name (parent opens PIN / selects). */
  onPick: (player: SavedPlayerPick) => void;
  /** Optional: open Create account from empty state / footer */
  onCreateAccount?: () => void;
  /** Highlight the tablet session player */
  sessionPlayerId?: string | null;
  /** Ids already seated — shown but still tappable (parent may toggle off) */
  selectedIds?: string[];
  title?: string;
}

export function SavedPlayersPicker({
  open,
  onClose,
  onPick,
  onCreateAccount,
  sessionPlayerId = null,
  selectedIds = [],
  title = "Saved players",
}: SavedPlayersPickerProps) {
  const players = usePlayersStore((s) => s.players);
  const syncFromServer = usePlayersStore((s) => s.syncFromServer);
  const hydrated = usePlayersStore((s) => s.hydrated);
  const hydrate = usePlayersStore((s) => s.hydrate);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const registered = useMemo(
    () => players.filter((p) => !p.isGuest),
    [players]
  );

  const filtered = useMemo(
    () => filterPlayersByName(registered, query),
    [registered, query]
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    hydrate();
    void syncFromServer();
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, hydrate, syncFromServer]);

  if (!open) return null;

  const selected = new Set(selectedIds);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col rounded-2xl border border-[var(--panel-border)] bg-black shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--panel-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg tracking-wide text-white">{title}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Search · tap a name · enter PIN
              {registered.length > 0 ? ` · ${registered.length} players` : ""}
            </p>
          </div>
          <button type="button" className="btn-ghost min-h-11 px-3" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="shrink-0 px-4 pt-3">
          <label className="block">
            <span className="sr-only">Search players</span>
            <input
              ref={inputRef}
              className="input min-h-12 w-full text-base"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a name…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {!hydrated ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">Loading…</p>
          ) : registered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p className="text-sm text-zinc-400">No saved players yet</p>
              <p className="text-xs text-zinc-600">
                Create an account with a display name + 4-digit PIN to appear here.
              </p>
              {onCreateAccount && (
                <button
                  type="button"
                  className="btn-primary min-h-12 px-6"
                  onClick={() => {
                    onClose();
                    onCreateAccount();
                  }}
                >
                  Create account
                </button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">
              No names match “{query.trim()}”
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((p) => {
                const isYou = sessionPlayerId === p.id;
                const isOn = selected.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick({ id: p.id, name: p.name });
                        onClose();
                      }}
                      className={cn(
                        "flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left",
                        isOn
                          ? "border-[var(--brand-red)] bg-[rgb(225_6_0/0.18)]"
                          : "border-[var(--panel-border)] bg-[var(--panel)] active:border-[var(--brand-red)]"
                      )}
                    >
                      <span className="truncate font-semibold text-white">{p.name}</span>
                      <span className="shrink-0 font-display text-[10px] tracking-wider text-zinc-500">
                        {isYou ? "You" : isOn ? "In match" : "PIN"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 border-t border-[var(--panel-border)] px-4 py-3">
          {onCreateAccount && registered.length > 0 && (
            <button
              type="button"
              className="btn-ghost min-h-12 flex-1"
              onClick={() => {
                onClose();
                onCreateAccount();
              }}
            >
              Create account
            </button>
          )}
          <button type="button" className="btn-ghost min-h-12 flex-1" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
