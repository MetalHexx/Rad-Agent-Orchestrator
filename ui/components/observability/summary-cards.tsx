import * as React from "react";
import type { SessionAgg } from "@/lib/observability/sessions";
import { humanizeTokens } from "@/lib/observability/format";

interface SummaryCardsProps {
  sessions: SessionAgg[];
  activeNow: number;
}

interface CardProps {
  label: string;
  value: string | number;
}

function SummaryCard({ label, value }: CardProps) {
  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 px-6 py-5 flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function SummaryCards({ sessions, activeNow }: SummaryCardsProps) {
  const totalSpend = sessions.reduce((sum, s) => sum + s.spend, 0);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <SummaryCard label="Total Spend" value={humanizeTokens(totalSpend)} />
      <SummaryCard label="Sessions" value={sessions.length} />
      <SummaryCard label="Active Now" value={activeNow} />
    </div>
  );
}
