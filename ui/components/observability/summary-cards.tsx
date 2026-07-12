import * as React from "react";
import type { SessionAgg } from "@/lib/observability/sessions";
import { SummaryCard, SummaryCardGrid, TotalSpendCard } from "./summary-card";
import { SPEND_LABELS, formatUsd } from "@/lib/observability/spend-display";

interface SummaryCardsProps {
  sessions: (SessionAgg & { cost: number | null })[];
  activeNow: number;
}

export function SummaryCards({ sessions, activeNow }: SummaryCardsProps) {
  const totalSpend = sessions.reduce((sum, s) => sum + s.spend, 0);
  // Sum of per-session dollars; any session with an unknown-priced model poisons the total to
  // "unavailable" rather than silently underreporting (mirrors spendReceipt's own dollars fold).
  const totalCost = sessions.some((s) => s.cost === null)
    ? null
    : sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0);

  return (
    <SummaryCardGrid columns={4}>
      <SummaryCard
        label={SPEND_LABELS.costUsd}
        value={formatUsd(totalCost)}
        tooltip="Dollar cost summed across sessions in view, at current model pricing; an unpriced model shows as unavailable, never $0."
      />
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
