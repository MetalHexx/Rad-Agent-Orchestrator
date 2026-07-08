"use client";
import * as React from "react";
import type { TranscriptEvent } from "@rad-orchestration/telemetry";
import { TranscriptEventCard } from "./transcript-event-card";
import { isTightResult, errorEventSeqs, windowEvents } from "@/lib/observability/transcript-view";
import { toToolCalls } from "@/lib/observability/tool-calls";

const DEFAULT_WINDOW = 400;

// The identity renderModeFor needs to classify a tool_result: the call's tool
// name for most tools, or — for a Read result specifically — the file path it
// read, since "Read of *.md" vs "Read of a source file" can't be told apart
// from the bare tool name alone.
function originatingToolKey(name: string, inputText: string): string {
  if (name !== "Read") return name;
  try {
    const parsed = JSON.parse(inputText) as { file_path?: unknown };
    return typeof parsed.file_path === "string" ? parsed.file_path : name;
  } catch {
    return name;
  }
}

export interface TranscriptTimelineProps {
  /** Already facet-filtered (via applyFacets) — this component renders, it does not filter. */
  events: TranscriptEvent[];
  errorCursor: number;
}

export function TranscriptTimeline({ events, errorCursor }: TranscriptTimelineProps) {
  const [expanded, setExpanded] = React.useState(false);
  const errorRefs = React.useRef<Map<number, HTMLElement>>(new Map());

  const { shown, hidden } = windowEvents(events, expanded ? Infinity : DEFAULT_WINDOW);

  // tool_result seq -> originating tool key (AD-6 pairing seam a follow-on task
  // consumes). Built from the full faceted `events`, not `shown` — the window
  // only trims the head, so a call cut from view can still have a visible result.
  const originatingToolByResultSeq = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const call of toToolCalls(events)) {
      if (call.resultEvent) map.set(call.resultEvent.seq, originatingToolKey(call.name, call.input.text));
    }
    return map;
  }, [events]);

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
