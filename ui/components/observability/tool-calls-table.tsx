"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TranscriptEventCard } from "./transcript-event-card";
import { toolArgPreview } from "@/lib/observability/transcript-view";
import type { ToolCall } from "@/lib/observability/tool-calls";

const COLS = "grid-cols-[3rem_8rem_1fr_5rem_2rem]";
const OPEN_TINT = "bg-[color:color-mix(in_srgb,var(--chart-2)_8%,transparent)]";

export interface ToolCallsTableProps {
  calls: ToolCall[];
  expanded: Set<number>;          // open call seqs (multi-open, AD-4, DD-10)
  onToggle: (seq: number) => void;
}

export function ToolCallsTable({ calls, expanded, onToggle }: ToolCallsTableProps) {
  if (calls.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No matching tool calls.</p>;
  }
  return (
    <div role="table" aria-label="Tool calls">
      <div role="row" className={cn("grid items-center gap-3 border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground", COLS)}>
        <span role="columnheader">#</span>
        <span role="columnheader">Tool</span>
        <span role="columnheader">Input</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" aria-label="Expand" />
      </div>
      {calls.map((call, i) => (
        <ToolCallRow key={call.seq} call={call} ordinal={i + 1} open={expanded.has(call.seq)} onToggle={() => onToggle(call.seq)} />
      ))}
    </div>
  );
}

function ToolCallRow({ call, ordinal, open, onToggle }: {
  call: ToolCall; ordinal: number; open: boolean; onToggle: () => void;
}) {
  return (
    <div role="row" className={cn("border-b border-border", open && OPEN_TINT)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "grid w-full items-center gap-3 px-4 py-2 text-left",
          "hover:bg-[color:color-mix(in_srgb,var(--foreground)_3%,transparent)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          COLS,
        )}
      >
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{ordinal}</span>
        <span className="min-w-0"><Badge variant="secondary" className="font-mono">{call.name}</Badge></span>
        <span className="truncate font-mono text-xs text-muted-foreground">{toolArgPreview(call.input.text, Infinity)}</span>
        <span><Badge variant={call.isError ? "destructive" : "success"}>{call.isError ? "error" : "ok"}</Badge></span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div className={cn("px-4 pb-3", OPEN_TINT)}>
          {/* Reuse the Transcript facet's card verbatim — pairing is adjacency only (AD-6, DD-8). */}
          <TranscriptEventCard event={call.callEvent} />
          {call.resultEvent ? <TranscriptEventCard event={call.resultEvent} tight showToolIO /> : null}
        </div>
      ) : null}
    </div>
  );
}
