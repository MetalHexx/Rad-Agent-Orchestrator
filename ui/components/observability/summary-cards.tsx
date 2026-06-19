import * as React from "react";
import type { SessionAgg } from "@/lib/observability/sessions";
import { humanizeTokens } from "@/lib/observability/format";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface SummaryCardsProps {
  sessions: SessionAgg[];
  activeNow: number;
}

interface CardProps {
  label: string;
  value: string | number;
  tooltip: string;
}

function SummaryCard({ label, value, tooltip }: CardProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          className="rounded-xl bg-card ring-1 ring-foreground/10 px-6 py-5 flex flex-col gap-1 cursor-default text-left w-full"
          aria-label={`${label}: ${value}. ${tooltip}`}
        >
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-3xl font-semibold tabular-nums">{value}</span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function SummaryCards({ sessions, activeNow }: SummaryCardsProps) {
  const totalSpend = sessions.reduce((sum, s) => sum + s.spend, 0);

  return (
    <div className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-3">
      <SummaryCard
        label="Total Spend"
        value={humanizeTokens(totalSpend)}
        tooltip="Effective tokens — a cache-aware, cost-shaped count summed across the main agent and all subagents. Not a dollar cost."
      />
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
    </div>
  );
}
