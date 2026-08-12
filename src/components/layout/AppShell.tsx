"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { usePlayReturnIdle } from "@/hooks/usePlayReturnIdle";
import { usePlaySessionIdleLogout } from "@/hooks/usePlaySessionIdleLogout";
import {
  isFromPlaySearch,
  playHref,
  statsHrefFromPlay,
} from "@/lib/play-kiosk";
import { useGameStore } from "@/store/game-store";
import { useSettingsStore } from "@/store/settings-store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Play" },
  { href: "/tv", label: "TV" },
  { href: "/players", label: "Players" },
  { href: "/leaderboard", label: "Stats" },
  { href: "/history", label: "History" },
  { href: "/admin", label: "Admin" },
];

/** Fullscreen / kiosk surfaces — no AppShell chrome at all. */
function isBareRoute(pathname: string) {
  return pathname === "/play" || pathname === "/tv" || pathname === "/board-setup";
}

function ShellBrand({ room }: { room?: string | null }) {
  return (
    <Link href={playHref(room)} className="flex min-w-0 items-center gap-2">
      <Image
        src="/brand/logo.png"
        alt="No.3"
        width={36}
        height={36}
        className="shrink-0 rounded-full"
      />
      <div className="min-w-0">
        <div className="font-logo truncate text-base text-white">
          No.<span className="text-[var(--brand-red)]">3</span> Darts
        </div>
      </div>
    </Link>
  );
}

/** Setup (`/`): Cancel → idle `/play`, plus Stats. No browser-back reliance. */
function SetupChromeActions({ room }: { room?: string | null }) {
  const router = useRouter();
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => router.replace(playHref(room))}
        className="btn-ghost min-h-11 px-4 font-display text-xs tracking-wider text-red-300"
      >
        Cancel
      </button>
      <Link
        href={statsHrefFromPlay("/", room)}
        className="btn-ghost min-h-11 px-4 font-display text-xs tracking-wider text-zinc-300"
      >
        Stats
      </Link>
    </div>
  );
}

function MainNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-wrap justify-end gap-0.5" aria-label="Main">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "min-h-10 rounded-lg px-2.5 py-2 font-display text-[11px] tracking-wider sm:px-3 sm:text-xs",
            pathname === item.href
              ? "bg-[var(--brand-red)] text-white"
              : "text-zinc-400 active:bg-[var(--panel)]"
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function ShellHeaderInner({
  pathname,
  kioskMode,
  room,
}: {
  pathname: string;
  kioskMode: boolean;
  room?: string | null;
}) {
  const searchParams = useSearchParams();
  const { fromPlay, back } = isFromPlaySearch((k) => searchParams.get(k));
  const hideNav = kioskMode || fromPlay || pathname === "/";

  usePlayReturnIdle(fromPlay, back);

  return (
    <header className="shrink-0 border-b border-[var(--panel-border)] bg-black">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-2">
        <ShellBrand room={room} />
        {fromPlay ? (
          <Link
            href={back}
            className="btn-primary min-h-11 shrink-0 px-4 font-display text-xs tracking-wider"
          >
            Back to play
          </Link>
        ) : pathname === "/" ? (
          <SetupChromeActions room={room} />
        ) : !hideNav ? (
          <MainNav pathname={pathname} />
        ) : null}
      </div>
    </header>
  );
}

function ShellHeaderFallback({
  pathname,
  kioskMode,
  room,
}: {
  pathname: string;
  kioskMode: boolean;
  room?: string | null;
}) {
  const hideNav = kioskMode || pathname === "/";
  return (
    <header className="shrink-0 border-b border-[var(--panel-border)] bg-black">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-2">
        <ShellBrand room={room} />
        {pathname === "/" ? (
          <SetupChromeActions room={room} />
        ) : !hideNav ? (
          <MainNav pathname={pathname} />
        ) : null}
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const settings = useSettingsStore();
  const hydrateGame = useGameStore((s) => s.hydrate);
  const bare = isBareRoute(pathname);
  const room = settings.roomName;

  useEffect(() => {
    settings.hydrate();
    hydrateGame();
  }, [settings, hydrateGame]);

  // Setup `/` + idle `/play`: 2-min inactivity → tablet sign-out (not mid-match).
  // Hook still runs for bare `/play` (chrome is skipped; idle logic is not).
  usePlaySessionIdleLogout();

  if (bare) {
    return <>{children}</>;
  }

  return (
    <div className="shell-black flex flex-col">
      <Suspense
        fallback={
          <ShellHeaderFallback
            pathname={pathname}
            kioskMode={settings.kioskMode}
            room={room}
          />
        }
      >
        <ShellHeaderInner
          pathname={pathname}
          kioskMode={settings.kioskMode}
          room={room}
        />
      </Suspense>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
