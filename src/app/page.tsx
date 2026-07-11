import { GameSetup } from "@/components/setup/GameSetup";

/** Compact home for iPad — setup only, no marketing fluff */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-3 py-3 sm:px-4 sm:py-4">
      <GameSetup />
    </div>
  );
}
