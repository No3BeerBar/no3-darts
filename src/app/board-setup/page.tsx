import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Board 1 Setup | No.3 Darts",
  robots: { index: false, follow: false },
};

/** Tiny stub - mini-PC should download Board1-Setup.bat and double-click it. */
export default function BoardSetupPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Board 1 Setup</h1>
      <p>
        <a href="/Board1-Setup.bat?v=3">Download Board1-Setup.bat</a>
        {" - single file: save, then double-click on the mini-PC."}
      </p>
      <p style={{ marginTop: 16 }}>
        Something wrong?{" "}
        <a href="/Board1-FixMe.bat?v=4">Double-click Fix Me</a>
        {" - kills leftovers, always refreshes the kit, brings Board 1 back."}
      </p>
      <p style={{ marginTop: 12, color: "#666", fontSize: 14 }}>
        The bat embeds setup (downloads the kit zip, writes Board 1 config, runs
        start-board). Kit zip only:{" "}
        <a href="/board-station-board1.zip">/board-station-board1.zip</a>
      </p>
    </main>
  );
}
