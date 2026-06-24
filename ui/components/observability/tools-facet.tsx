"use client";
import * as React from "react";
import type { AgentTranscript } from "@rad-orchestration/telemetry";
import { ToolBreakdown } from "./tool-breakdown";
import { ToolCallsControls } from "./tool-calls-controls";
import { ToolCallsTable } from "./tool-calls-table";
import { toToolCalls, filterToolCalls } from "@/lib/observability/tool-calls";

const CARD = "rounded-xl bg-card ring-1 ring-foreground/10"; // Overview recipe (DD-1)

export interface ToolsFacetProps {
  /** Already-fetched transcript — read directly each render, no fetch, no snapshot (AD-1, AD-5, NFR-1, NFR-2). */
  transcript: AgentTranscript;
}

export function ToolsFacet({ transcript }: ToolsFacetProps) {
  const [toolFilter, setToolFilter] = React.useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<number>>(() => new Set());

  // Derive from props on EVERY render. Each SSE refetch replaces the whole
  // transcript object, so transcript.events is a fresh reference and these
  // memos recompute — the facet updates in realtime without snapshotting (AD-5, NFR-2, FR-9).
  const calls = React.useMemo(() => toToolCalls(transcript.events), [transcript.events]);
  const shown = React.useMemo(
    () => filterToolCalls(calls, { toolFilter, errorsOnly, query }),
    [calls, toolFilter, errorsOnly, query],
  );
  const toolNames = React.useMemo(() => Object.keys(transcript.toolSummary.byName), [transcript.toolSummary]);

  const toggle = React.useCallback((seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });
  }, []);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="flex flex-col gap-4">
        <ToolBreakdown summary={transcript.toolSummary} />
        <section className={CARD}>
          <div className="flex items-center border-b border-border px-5 py-4">
            <h3 className="text-sm font-medium text-foreground">Calls</h3>
          </div>
          <ToolCallsControls
            errorsOnly={errorsOnly} onErrorsOnly={setErrorsOnly}
            toolFilter={toolFilter} onToolFilter={setToolFilter}
            toolNames={toolNames}
            query={query} onQuery={setQuery}
            shown={shown.length} total={calls.length}
          />
          <ToolCallsTable calls={shown} expanded={expanded} onToggle={toggle} />
        </section>
      </div>
    </div>
  );
}
