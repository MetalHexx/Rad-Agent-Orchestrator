"use client";
import * as React from "react";
import type { TranscriptEvent } from "@rad-orchestration/telemetry";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TranscriptEventCard } from "./transcript-event-card";
import { visibleEvents, isTightResult, errorEventSeqs, windowEvents } from "@/lib/observability/transcript-view";

const DEFAULT_WINDOW = 400;

export interface TranscriptTimelineProps {
  events: TranscriptEvent[];
  showThinking: boolean;
  showToolIO: boolean;
  query: string;
  errorCursor: number;
}

export function TranscriptTimeline({ events, showThinking, showToolIO, query, errorCursor }: TranscriptTimelineProps) {
  const [expanded, setExpanded] = React.useState(false);
  const errorRefs = React.useRef<Map<number, HTMLElement>>(new Map());

  const visible = visibleEvents(events, { showThinking, query });
  const { shown, hidden } = windowEvents(visible, expanded ? Infinity : DEFAULT_WINDOW);

  React.useEffect(() => {
    const seqs = errorEventSeqs(events);
    if (seqs.length === 0 || errorCursor < 0) return;
    const target = seqs[((errorCursor % seqs.length) + seqs.length) % seqs.length];
    const el = errorRefs.current.get(target);
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [errorCursor, events]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-[820px] px-5 py-4">
        {hidden > 0 ? (
          <button type="button" onClick={() => setExpanded(true)}
            className="mb-3 w-full rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            Showing latest {shown.length} of {visible.length} events — show all
          </button>
        ) : null}
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No events match the current filter.</p>
        ) : (
          shown.map((e, i) => {
            const isErr = e.kind === "tool_result" && !!e.result?.isError;
            return (
              <div key={e.seq} data-seq={e.seq}
                ref={isErr ? (el) => { if (el) errorRefs.current.set(e.seq, el); } : undefined}>
                <TranscriptEventCard event={e} tight={isTightResult(shown, i)} showToolIO={showToolIO} />
              </div>
            );
          })
        )}
      </div>
    </ScrollArea>
  );
}
