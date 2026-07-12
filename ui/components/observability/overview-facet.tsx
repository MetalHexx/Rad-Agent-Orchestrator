import * as React from "react";
import type { AgentTranscript, ObservabilityUsageRow } from "@rad-orchestration/telemetry";
import { SummaryCard, SummaryCardGrid } from "./summary-card";
import { RichText } from "./rich-text";
import { humanizeTokens } from "@/lib/observability/format";
import { formatDuration } from "@/lib/observability/duration-format";
import { SPEND_LABELS, formatUsd, spendReceipt } from "@/lib/observability/spend-display";
import { TokenBreakdown } from "./token-breakdown";

const CARD = "rounded-xl bg-card ring-1 ring-foreground/10"; // matches summary-card.tsx + agent-tree.tsx (DD-3)

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center px-5 py-4 border-b border-border">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
    </div>
  );
}

export interface OverviewFacetProps {
  /** The already-fetched transcript — read directly, no further fetching (AD-1, NFR-2). */
  transcript: AgentTranscript;
  /** The inspected agent's deduped harvested-usage rows — the single source (R8) every spend
   *  figure on this panel derives from, so the modal agrees with the session-view row by construction. */
  rows: ObservabilityUsageRow[];
}

/**
 * OverviewFacet — at-a-glance summary panel for an agent (FR-1..FR-5).
 * Container-agnostic and props-only (NFR-2); reads the transcript straight off the prop (AD-1).
 */
export function OverviewFacet({ transcript, rows }: OverviewFacetProps) {
  const { toolSummary, filesTouched, prompt, result, durationMs } = transcript;

  // Single source for every spend figure on this panel — the same deduped harvested rows the
  // session-view row derives from (R8), so the modal's spend numbers agree with the row by
  // construction. The transcript stays the source for the operational cards below.
  const receipt = spendReceipt(rows);

  const toolEntries = Object.entries(toolSummary.byName).sort((a, b) => b[1] - a[1]);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="flex flex-col gap-4">
        {/* (1) Cost trio — Total Spend (weighted) / Cost (USD) / New tokens, from spendReceipt(rows) */}
        <SummaryCardGrid columns={3}>
          <SummaryCard
            label="Total Spend (weighted)"
            value={humanizeTokens(receipt.costWeighted)}
            tooltip="Effective tokens for this agent — a cache-aware, cost-weighted count matching the Agent Breakdown row. Dollar cost is shown separately, not blended into this count."
          />
          <SummaryCard
            label={SPEND_LABELS.costUsd}
            value={formatUsd(receipt.dollars)}
            tooltip="Dollar cost for this agent at current model pricing; an unpriced model shows as unavailable, never $0."
          />
          <SummaryCard
            label={SPEND_LABELS.newTokens}
            value={humanizeTokens(receipt.newTokens)}
            tooltip="Net-new context tokens created by this agent (cache-creation total) — the harness headline figure."
          />
        </SummaryCardGrid>
        {/* (2) Operational grid — Duration / Tool Calls / Errors / Files (FR-2, DD-1, DD-2) */}
        <SummaryCardGrid columns={4}>
          <SummaryCard
            label="Duration"
            value={durationMs != null ? formatDuration(durationMs) : "—"}
            tooltip="Wall-clock time from the agent's first to last recorded event."
          />
          <SummaryCard label="Tool Calls" value={toolSummary.total} tooltip="Total tool invocations this agent made." />
          <SummaryCard label="Errors" value={toolSummary.errors} tooltip="Tool calls that returned an error result." />
          <SummaryCard label="Files" value={filesTouched.length} tooltip="Distinct files this agent created or edited." />
        </SummaryCardGrid>
        <TokenBreakdown
          input={receipt.raw.input}
          output={receipt.raw.output}
          cacheRead={receipt.raw.cacheRead}
          cacheCreate={receipt.raw.cacheCreate}
        />

        {/* (2) Tools card — chips by descending count + Tools-facet hint (FR-3, DD-5, DD-7) */}
        <section className={CARD}>
          <PanelHeader title="Tools" />
          <div className="flex flex-wrap items-center gap-2 px-5 py-3.5">
            {toolEntries.length === 0 ? (
              <span className="text-sm text-muted-foreground">No tool calls.</span>
            ) : (
              <>
                {toolEntries.map(([name, count]) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-xs text-foreground"
                  >
                    {name} <span className="font-semibold text-chart-2">×{count}</span>
                  </span>
                ))}
                <span className="ml-auto text-xs text-muted-foreground">
                  full breakdown in the <span className="text-chart-2">Tools facet</span>
                </span>
              </>
            )}
          </div>
        </section>

        {/* (3) Spawn Prompt — verbatim mono body (FR-4, DD-3, DD-7) */}
        <section className={CARD}>
          <PanelHeader title="Spawn Prompt" />
          <div className="px-5 py-4">
            {prompt ? (
              <RichText body={prompt} variant="mono" />
            ) : (
              <p className="text-sm text-muted-foreground">No spawn prompt recorded.</p>
            )}
          </div>
        </section>

        {/* (4) Result — light-markdown prose body (FR-5, DD-3, DD-7) */}
        <section className={CARD}>
          <PanelHeader title="Result" />
          <div className="px-5 py-4">
            {result ? (
              <RichText body={result} variant="prose" />
            ) : (
              <p className="text-sm text-muted-foreground">No result recorded.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
