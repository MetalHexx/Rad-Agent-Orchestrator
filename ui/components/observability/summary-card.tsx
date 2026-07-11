import * as React from "react";
import { humanizeTokens } from "@/lib/observability/format";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface SummaryCardProps {
  label: string;
  value: string | number;
  tooltip: string;
}

/** The shared stat-tile primitive every Observability summary card renders (DD-3). */
export function SummaryCard({ label, value, tooltip }: SummaryCardProps) {
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

// Tailwind purges dynamic `sm:grid-cols-${n}`; the literal class strings must appear in source (AD-4).
const GRID_COLS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
};

interface SummaryCardGridProps {
  columns?: number;
  children?: React.ReactNode;
}

/** Shared responsive grid: one column on narrow screens, `columns` at sm+ (AD-4, DD-1). */
export function SummaryCardGrid({ columns = 3, children }: SummaryCardGridProps) {
  const cols = GRID_COLS[columns] ?? GRID_COLS[3];
  return <div className={`grid grid-cols-1 gap-[var(--space-5)] ${cols}`}>{children}</div>;
}

const TOTAL_SPEND_TOOLTIP =
  "Effective tokens — a cache-aware, cost-weighted count summed across the main agent and all subagents. Dollar cost is shown separately, not blended into this count.";

/** The single shared Total-Spend card both Observability views render (FR-2). */
export function TotalSpendCard({ spend }: { spend: number }) {
  return <SummaryCard label="Total Spend (weighted)" value={humanizeTokens(spend)} tooltip={TOTAL_SPEND_TOOLTIP} />;
}
