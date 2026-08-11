"use client";

import type { GameModeId } from "@/engine";
import { getHowToPlay } from "@/lib/how-to-play";

export interface HowToPlayModalProps {
  open: boolean;
  mode: GameModeId;
  onClose: () => void;
}

/**
 * Patron-facing rules sheet for the currently selected / active game mode.
 * Modal (not a new route) so kiosk Back / idle chrome stays on the play flow.
 * Guests and PIN players — no staff unlock required.
 */
export function HowToPlayModal({ open, mode, onClose }: HowToPlayModalProps) {
  if (!open) return null;

  const guide = getHowToPlay(mode);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`How to play ${guide.title}`}
        className="flex max-h-[min(88dvh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[rgb(225_6_0/0.4)] bg-[#050505] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[rgb(225_6_0/0.25)] px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[10px] tracking-[0.2em] text-[var(--brand-red-bright)]">
                How to play
              </p>
              <h2 className="mt-0.5 font-display text-xl tracking-wide text-white">{guide.title}</h2>
              <p className="mt-1 text-sm leading-snug text-zinc-400">{guide.summary}</p>
            </div>
            <button
              type="button"
              className="btn-ghost min-h-11 shrink-0 px-3 text-sm"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          {guide.sections.map((section) => (
            <section key={section.title}>
              <h3 className="font-display text-xs tracking-[0.18em] text-[var(--brand-red-bright)]">
                {section.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-200">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="shrink-0 border-t border-[rgb(225_6_0/0.22)] bg-[#050505] p-3">
          <button type="button" className="btn-primary min-h-12 w-full text-sm" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
