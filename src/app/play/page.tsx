import { Suspense } from "react";
import { ScoringScreen } from "@/components/scoring/ScoringScreen";
import { RoomQuerySync } from "@/components/layout/RoomQuerySync";

export default function PlayPage() {
  return (
    <>
      <Suspense fallback={null}>
        <RoomQuerySync />
      </Suspense>
      <ScoringScreen />
    </>
  );
}
