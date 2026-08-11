"use client";

import { StaffTournamentGate } from "@/components/tournament/StaffTournamentGate";

export default function TournamentLayout({ children }: { children: React.ReactNode }) {
  return <StaffTournamentGate>{children}</StaffTournamentGate>;
}
