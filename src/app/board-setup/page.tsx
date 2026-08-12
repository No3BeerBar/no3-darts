import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Board Station Setup | No.3 Darts",
  description: "Download the Board 1 mini-PC kit for No.3 Craft Beer Bar.",
  robots: { index: false, follow: false },
};

const PROD = "https://no3-darts-production.up.railway.app";
const ZIP_HREF = "/board-station-board1.zip";
const IPAD_URL = `${PROD}/play?room=Board%201`;
const TV_URL = `${PROD}/tv`;

export default function BoardSetupPage() {
  return (
    <div className="min-h-dvh bg-black px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
        <header className="space-y-3 text-center">
          <p className="font-logo text-3xl tracking-wide sm:text-4xl">
            No.<span className="text-[var(--brand-red)]">3</span> Darts
          </p>
          <h1 className="font-display text-xl tracking-[0.12em] text-[var(--brand-red)] sm:text-2xl">
            Board Station Setup
          </h1>
          <p className="text-sm leading-relaxed text-zinc-400 sm:text-base">
            Mini-PC kit for Board 1 — download, unzip, set Autodarts path, run.
          </p>
        </header>

        <a
          href={ZIP_HREF}
          download
          className="flex min-h-16 items-center justify-center rounded-xl bg-[var(--brand-red)] px-6 py-5 text-center font-display text-lg tracking-[0.14em] text-white shadow-[0_0_0_1px_rgba(225,6,0,0.5)] transition active:scale-[0.99] sm:min-h-20 sm:text-xl"
        >
          Download Board 1 Kit (.zip)
        </a>

        <ol className="space-y-3 border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-4 text-left text-sm leading-relaxed text-zinc-200 sm:text-base">
          <li>
            <span className="font-display text-[var(--brand-red)]">1.</span> Unzip
            to <code className="text-white">C:\No3Darts\</code>
          </li>
          <li>
            <span className="font-display text-[var(--brand-red)]">2.</span> Install
            Python 3 if needed
          </li>
          <li>
            <span className="font-display text-[var(--brand-red)]">3.</span> Edit{" "}
            <code className="text-white">board-station\config.yaml</code> → set{" "}
            <code className="text-white">autodarts.exe_path</code>
          </li>
          <li>
            <span className="font-display text-[var(--brand-red)]">4.</span>{" "}
            Double-click{" "}
            <code className="text-white">board-station\start-board.bat</code>
          </li>
          <li>
            <span className="font-display text-[var(--brand-red)]">5.</span> Open the
            iPad URL below
          </li>
        </ol>

        <section className="space-y-4">
          <UrlBlock label="iPad (Board 1)" href={IPAD_URL} />
          <UrlBlock label="TV" href={TV_URL} />
          <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-4">
            <p className="font-display text-xs tracking-[0.14em] text-zinc-500">
              Staff PIN
            </p>
            <p className="mt-2 text-base text-zinc-100">
              Default <span className="font-mono text-[var(--brand-red)]">1234</span>
              {" — "}match Admin → Staff PIN / Railway{" "}
              <code className="text-zinc-300">STAFF_PIN</code>
            </p>
          </div>
        </section>

        <p className="text-center text-xs text-zinc-600">
          Direct zip:{" "}
          <a href={ZIP_HREF} className="text-zinc-400 underline underline-offset-2">
            /board-station-board1.zip
          </a>
        </p>
      </div>
    </div>
  );
}

function UrlBlock({ label, href }: { label: string; href: string }) {
  return (
    <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-4">
      <p className="font-display text-xs tracking-[0.14em] text-zinc-500">{label}</p>
      <a
        href={href}
        className="mt-2 block break-all text-base font-medium text-[var(--brand-red-bright)] underline decoration-[var(--brand-red-dim)] underline-offset-2"
      >
        {href}
      </a>
    </div>
  );
}
