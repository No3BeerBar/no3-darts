"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const settings = useSettingsStore();
  const bare = pathname === "/play" || pathname === "/tv";

  useEffect(() => {
    settings.hydrate();
  }, [settings]);

  if (bare) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-dvh flex-col text-zinc-100">
      <header className="shrink-0 border-b border-[rgb(225_6_0/0.28)] bg-[rgba(5,5,5,0.95)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-2">
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
          <nav className="flex flex-wrap justify-end gap-0.5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "min-h-10 rounded-lg px-2.5 py-2 font-display text-[11px] tracking-wider sm:px-3 sm:text-xs",
                  pathname === item.href
                    ? "bg-[var(--brand-red)] text-white"
                    : "text-zinc-400 active:bg-zinc-800"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
