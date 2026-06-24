"use client";
import * as React from "react";
import type { ToolSummary } from "@rad-orchestration/telemetry";
import { Badge } from "@/components/ui/badge";

// Overview card recipe, verbatim for cross-facet consistency (DD-1).
const CARD = "rounded-xl bg-card ring-1 ring-foreground/10";

export interface ToolBreakdownProps {
  /** Read straight from the prop — no fetch, no snapshot (NFR-1). */
  summary: ToolSummary;
}

export function ToolBreakdown({ summary }: ToolBreakdownProps) {
  const entries = Object.entries(summary.byName).sort((a, b) => b[1] - a[1]);
  const max = entries.length > 0 ? entries[0][1] : 0;
  const distinct = entries.length;
  return (
    <section className={CARD}>
      <div className="flex items-center border-b border-border px-5 py-4">
        <h3 className="text-sm font-medium text-foreground">Calls by tool</h3>
      </div>
      <div className="flex flex-col gap-2.5 px-5 py-4">
        {entries.length === 0 ? (
          <span className="text-sm text-muted-foreground">No tool calls.</span>
        ) : (
          entries.map(([name, count]) => (
            <div key={name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
              <Badge variant="secondary" className="justify-self-start font-mono">{name}</Badge>
              {/* SpendBar meter recipe inlined as a single flat volume bar (AD-7, DD-4). */}
              <div className="h-3.5 overflow-hidden rounded-md bg-muted" role="presentation">
                <div className="h-full" style={{ width: `${max > 0 ? (count / max) * 100 : 0}%`, background: "var(--chart-2)" }} />
              </div>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">×{count}</span>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border px-5 py-3">
        <span className="text-xs text-muted-foreground">
          total {summary.total} calls · {distinct} {distinct === 1 ? "tool" : "tools"}
        </span>
        <Badge variant={summary.errors > 0 ? "destructive" : "secondary"}>
          {summary.errors} {summary.errors === 1 ? "error" : "errors"}
        </Badge>
      </div>
    </section>
  );
}
