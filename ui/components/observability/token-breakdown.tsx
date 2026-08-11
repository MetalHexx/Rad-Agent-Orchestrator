import { Info } from "lucide-react";
import { humanizeTokens } from "@/lib/observability/format";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Normalized raw-token shape both surfaces map onto.
 * `spend`/`dollars` are accepted so callers (see overview-facet.tsx) can pass the same receipt
 * used for the trio cards above, but this component never renders a dollar figure (DD-1, enforced
 * by token-breakdown.test.tsx) — do not destructure or render them here.
 */
export interface TokenBreakdownProps {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  spend?: number;
  dollars?: number | null;
}

const CELLS = [
  { label: "Input", key: "input", weight: "×1" },
  { label: "Output", key: "output", weight: "×5" },
  { label: "Cache read", key: "cacheRead", weight: "×0.1" },
  { label: "Cache create", key: "cacheCreate", weight: "×1.25" },
] as const;

const BREAKDOWN_TOOLTIP =
  "Raw API token counts, each weighted by relative cost — input ×1, output ×5, cache read ×0.1, " +
  "cache create ×1.25 — into the Token Spend figure above. See the Cost (USD) and Token Spend cards " +
  "above for the dollar and weighted totals; this row never duplicates them.";

/**
 * TokenBreakdown — one-line raw-token receipt, strictly subordinate to the caller's spend cards (DD-1).
 * Pure, props-only, container-agnostic (NFR-3); never duplicates the cache weights (NFR-2).
 */
export function TokenBreakdown({ input, output, cacheRead, cacheCreate }: TokenBreakdownProps) {
  const values = { input, output, cacheRead, cacheCreate };
  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
        {CELLS.map((cell, i) => (
          <span key={cell.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-border" aria-hidden="true">·</span>}
            <span>
              {cell.label} <span className="opacity-60">{cell.weight}</span>
            </span>
            <span className="text-foreground">{humanizeTokens(values[cell.key])}</span>
          </span>
        ))}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Info className="ml-1 h-3 w-3 shrink-0 cursor-default opacity-40 hover:opacity-70" />} />
            <TooltipContent>{BREAKDOWN_TOOLTIP}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
