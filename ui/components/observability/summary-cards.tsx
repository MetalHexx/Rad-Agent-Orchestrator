import * as React from "react";
import type { SessionAgg } from "@/lib/observability/sessions";
import { SummaryCard, SummaryCardGrid, TotalSpendCard } from "./summary-card";

interface SummaryCardsProps {
  sessions: SessionAgg[];
  activeNow: number;
}

export function SummaryCards({ sessions, activeNow }: SummaryCardsProps) {
  const totalSpend = sessions.reduce((sum, s) => sum + s.spend, 0);

  return (
    <SummaryCardGrid columns={3}>
      <TotalSpendCard spend={totalSpend} />
      <SummaryCard
        label="Sessions"
        value={sessions.length}
        tooltip="Number of Claude sessions (process invocations) visible in the current view."
      />
      <SummaryCard
        label="Active Now"
        value={activeNow}
        tooltip="Sessions that sent a token event in the last few minutes — the glowing dots."
      />
    </SummaryCardGrid>
  );
}
