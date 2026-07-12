import * as React from "react";
import type { SessionAgg } from "@/lib/observability/sessions";
import { sessionDuration } from "@/lib/observability/sessions";
import { formatDuration } from "@/lib/observability/duration-format";
import { countSubagents } from "@/lib/observability/subagent-count";
import { SummaryCard, SummaryCardGrid, TotalSpendCard } from "./summary-card";
import { SPEND_LABELS, formatUsd, spendReceipt } from "@/lib/observability/spend-display";

/** Session-detail summary strip: Cost (USD) · Token Spend (shared) · Subagents · Duration (FR-1, DD-1). */
export function SessionSummaryCards({ session }: { session: SessionAgg }) {
  const dollars = spendReceipt(session.rows).dollars;
  return (
    <SummaryCardGrid columns={4}>
      <SummaryCard
        label={SPEND_LABELS.costUsd}
        value={formatUsd(dollars)}
        tooltip="Dollar cost summed across this session's rows in view, at current model pricing; an unpriced model shows as unavailable, never $0."
      />
      <TotalSpendCard spend={session.spend} />
      <SummaryCard
        label="Subagents"
        value={countSubagents(session)}
        tooltip="Distinct subagents this session spawned. A session with no subagents reads 0."
      />
      <SummaryCard
        label="Duration"
        value={formatDuration(sessionDuration(session))}
        tooltip="Wall-clock span from this session's first to last token event, including idle gaps — not billed time."
      />
    </SummaryCardGrid>
  );
}
