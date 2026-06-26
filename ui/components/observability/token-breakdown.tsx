import { Info } from "lucide-react";
import { humanizeTokens } from "@/lib/observability/format";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** Normalized raw-token shape both surfaces map onto; `spend` is the pre-derived effective figure (AD-2, AD-3). */
export interface TokenBreakdownProps {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  spend: number;
}

const CELLS = [
  { label: "Input", key: "input" },
  { label: "Output", key: "output" },
  { label: "Cache read", key: "cacheRead" },
  { label: "Cache create", key: "cacheCreate" },
] as const;

/**
 * TokenBreakdown — one-line raw-token receipt, strictly subordinate to Total Spend (DD-1).
 * Pure, props-only, container-agnostic (NFR-3); never duplicates the cache weights (NFR-2).
 */
export function TokenBreakdown({ input, output, cacheRead, cacheCreate, spend }: TokenBreakdownProps) {
  const values = { input, output, cacheRead, cacheCreate };
  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
        {CELLS.map((cell, i) => (
          <span key={cell.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-border" aria-hidden="true">·</span>}
            <span>{cell.label}</span>
            <span className="text-foreground">{humanizeTokens(values[cell.key])}</span>
          </span>
        ))}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Info className="ml-1 h-3 w-3 shrink-0 cursor-default opacity-40 hover:opacity-70" />} />
            <TooltipContent>Raw API counts · fold into Total Spend {humanizeTokens(spend)} via cache-aware weighting</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
