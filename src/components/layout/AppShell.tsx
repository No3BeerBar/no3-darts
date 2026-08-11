"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { usePlayReturnIdle } from "@/hooks/usePlayReturnIdle";
import { isFromPlaySearch, statsHrefFromPlay } from "@/lib/play-kiosk";
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
  return pathname === "/play" || pathname === "/tv";
}

function ShellBrand() {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2">
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

function ShellHeaderInner({
  pathname,
  kioskMode,
}: {
  pathname: string;
  kioskMode: boolean;
}) {
  const searchParams = useSearchParams();
  const { fromPlay, back } = isFromPlaySearch((k) => searchParams.get(k));
  const hideNav = kioskMode || fromPlay || pathname === "/";

  usePlayReturnIdle(fromPlay, back);

  return (
    <header className="shrink-0 border-b border-[var(--panel-border)] bg-black">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-2">
        <ShellBrand />
        {fromPlay ? (
          <Link
            href={back}
            className="btn-primary min-h-11 shrink-0 px-4 font-display text-xs tracking-wider"
          >
            Back to play
          </Link>
        ) : pathname === "/" ? (
          <Link
            href={statsHrefFromPlay("/")}
            className="btn-ghost min-h-11 shrink-0 px-4 font-display text-xs tracking-wider text-zinc-300"
          >
            Stats
          </Link>
        ) : !hideNav ? (
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
        ) : null}
      </div>
    </header>
  );
}

function ShellHeaderFallback({
  pathname,
  kioskMode,
}: {
  pathname: string;
  kioskMode: boolean;
}) {
  const hideNav = kioskMode || pathname === "/";
  return (
    <header className="shrink-0 border-b border-[var(--panel-border)] bg-black">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-2">
        <ShellBrand />
        {pathname === "/" ? (
          <Link
            href={statsHrefFromPlay("/")}
            className="btn-ghost min-h-11 shrink-0 px-4 font-display text-xs tracking-wider text-zinc-300"
          >
            Stats
          </Link>
        ) : !hideNav ? (
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
        ) : null}
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const settings = useSettingsStore();
  const bare = isBareRoute(pathname);

  useEffect(() => {
    settings.hydrate();
  }, [settings]);

  if (bare) {
    return <>{children}</>;
  }

  return (
    <div className="shell-black flex flex-col">
      <Suspense
        fallback={
          <ShellHeaderFallback pathname={pathname} kioskMode={settings.kioskMode} />
        }
      >
        <ShellHeaderInner pathname={pathname} kioskMode={settings.kioskMode} />
      </Suspense>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
