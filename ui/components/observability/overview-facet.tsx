import * as React from "react";
import type { AgentTranscript } from "@rad-orchestration/telemetry";
import { SummaryCard, SummaryCardGrid } from "./summary-card";
import { RichText } from "./rich-text";
import { humanizeTokens } from "@/lib/observability/format";
import { formatDuration } from "@/lib/observability/duration-format";
import { effectiveTokens } from "@/lib/observability/effective-tokens";

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
}

/**
 * OverviewFacet — at-a-glance summary panel for an agent (FR-1..FR-5).
 * Container-agnostic and props-only (NFR-2); reads the transcript straight off the prop (AD-1).
 */
export function OverviewFacet({ transcript }: OverviewFacetProps) {
  const { tokens, toolSummary, filesTouched, prompt, result, durationMs } = transcript;

  // Canonical cache-aware Spend unit, reused — weights are never duplicated here (AD-2).
  const spend = effectiveTokens({
    inputTokens: tokens.in,
    outputTokens: tokens.out,
    cacheReadTokens: tokens.cacheRead,
    cacheCreationTokens: tokens.cacheCreate,
  });

  const toolEntries = Object.entries(toolSummary.byName).sort((a, b) => b[1] - a[1]);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="flex flex-col gap-4">
        {/* (1) Scorecard — reused summary-card kit, no subtext, five-up (FR-2, DD-1, DD-2) */}
        <SummaryCardGrid columns={5}>
          <SummaryCard
            label="Total Spend"
            value={humanizeTokens(spend)}
            tooltip="Effective tokens for this agent: a cache-aware, cost-shaped count, not a dollar cost."
          />
          <SummaryCard
            label="Duration"
            value={durationMs != null ? formatDuration(durationMs) : "—"}
            tooltip="Wall-clock time from the agent's first to last recorded event."
          />
          <SummaryCard label="Tool Calls" value={toolSummary.total} tooltip="Total tool invocations this agent made." />
          <SummaryCard label="Errors" value={toolSummary.errors} tooltip="Tool calls that returned an error result." />
          <SummaryCard label="Files" value={filesTouched.length} tooltip="Distinct files this agent created or edited." />
        </SummaryCardGrid>

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
