import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Board Station Kit | No.3 Darts",
  robots: { index: false, follow: false },
};

/** Minimal stub — prefer the direct zip URL on the mini-PC. */
export default function BoardSetupPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Board Station — Board 1</h1>
      <p>
        <a href="/board-station-board1.zip">Download board-station-board1.zip</a>
      </p>
    </main>
  );
}
