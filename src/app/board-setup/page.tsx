import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Board 1 Setup | No.3 Darts",
  robots: { index: false, follow: false },
};

/** Tiny stub — mini-PC should download Board1-Setup.bat and double-click it. */
export default function BoardSetupPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Board 1 Setup</h1>
      <p>
        <a href="/Board1-Setup.bat">Download Board1-Setup.bat</a>
        {" — save, then double-click on the mini-PC."}
      </p>
      <p style={{ marginTop: 12, color: "#666", fontSize: 14 }}>
        Kit zip (used by the bat):{" "}
        <a href="/board-station-board1.zip">/board-station-board1.zip</a>
      </p>
    </main>
  );
}
