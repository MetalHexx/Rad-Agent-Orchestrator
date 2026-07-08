"use client";
import * as React from "react";
import type { TranscriptEvent } from "@rad-orchestration/telemetry";
import { TranscriptEventCard } from "./transcript-event-card";
import { isTightResult, errorEventSeqs, windowEvents } from "@/lib/observability/transcript-view";

const DEFAULT_WINDOW = 400;

export interface TranscriptTimelineProps {
  /** Already facet-filtered (via applyFacets) — this component renders, it does not filter. */
  events: TranscriptEvent[];
  /**
   * tool_result seq -> originating tool key (AD-6 pairing seam, see
   * tool-calls.ts#originatingToolByResult). MUST be computed by the caller from
   * the full, unfiltered transcript — never from `events` above, which is
   * already facet-filtered and can be missing the tool_call half of a pair
   * whose tool_result is still visible.
   */
  originatingToolByResultSeq: Map<number, string>;
  errorCursor: number;
}

export function TranscriptTimeline({ events, originatingToolByResultSeq, errorCursor }: TranscriptTimelineProps) {
  const [expanded, setExpanded] = React.useState(false);
  const errorRefs = React.useRef<Map<number, HTMLElement>>(new Map());

  const { shown, hidden } = windowEvents(events, expanded ? Infinity : DEFAULT_WINDOW);

  // Scroll to the current error ONLY on an explicit jump click (errorCursor change).
  // `events` is intentionally NOT a dep: each SSE refetch yields a fresh events
  // reference, and including it re-fired this effect on every live tick, yanking
  // the scroll back to the error mid-stream. Read events via closure instead.
  React.useEffect(() => {
    const seqs = errorEventSeqs(events);
    if (seqs.length === 0 || errorCursor < 0) return;
    const target = seqs[((errorCursor % seqs.length) + seqs.length) % seqs.length];
    const el = errorRefs.current.get(target);
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorCursor]);

  return (
    // Native overflow scroll (same as the Tools/Files/Overview facets), NOT the
    // @base-ui ScrollArea. `[transform:translateZ(0)]` promotes this scroller to
    // its own GPU compositing layer: without it, expanding a more/less block grows
    // the (very tall) content and Chromium fails to re-raster the layer, blanking
    // the panel until a re-render. Its own layer repaints reliably on the reflow.
    <div className="h-full overflow-y-auto p-5 [transform:translateZ(0)]">
      {hidden > 0 ? (
        <button type="button" onClick={() => setExpanded(true)}
          className="mb-3 w-full rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Showing latest {shown.length} of {events.length} events — show all
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
              <TranscriptEventCard
                event={e}
                tight={isTightResult(shown, i)}
                originatingTool={e.kind === "tool_result" ? originatingToolByResultSeq.get(e.seq) : undefined}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
