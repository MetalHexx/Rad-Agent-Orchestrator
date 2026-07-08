"use client";
import * as React from "react";
import type { AgentTranscript, TranscriptEvent } from "@rad-orchestration/telemetry";
import { TranscriptControls } from "./transcript-controls";
import { TranscriptTimeline } from "./transcript-timeline";
import { applyFacets, errorEventSeqs } from "@/lib/observability/transcript-view";
import type { TranscriptFacetState } from "@/lib/observability/transcript-view";
import { originatingToolByResult } from "@/lib/observability/tool-calls";

export interface TranscriptFacetProps {
  transcript: AgentTranscript;
}

function toolOptionsFrom(byName: Record<string, number>): { value: string; count: number }[] {
  return Object.entries(byName).map(([value, count]) => ({ value, count }));
}

// Files ▾ options are the real file_change ops present — edit/write/snapshot.
// Reads are tool_call events (Read), surfaced via Tools ▾ instead.
function fileOptionsFrom(events: TranscriptEvent[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "file_change" && e.file) counts.set(e.file.op, (counts.get(e.file.op) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

const defaultFacets = (): TranscriptFacetState => ({
  types: { user: true, assistant: true, thinking: true, errors: true },
  tools: "all",
  files: "all",
  query: "",
});

export function TranscriptFacet({ transcript }: TranscriptFacetProps) {
  const events = transcript.events;
  const [facets, setFacets] = React.useState<TranscriptFacetState>(defaultFacets);
  const [errorCursor, setErrorCursor] = React.useState(-1);

  const toolOptions = React.useMemo(() => toolOptionsFrom(transcript.toolSummary.byName), [transcript.toolSummary]);
  const fileOptions = React.useMemo(() => fileOptionsFrom(events), [events]);
  // applyFacets removes a filtered-off item outright rather than blanking its body,
  // so a facet-off toolbar and the underlying timeline stay in sync (no showToolIO
  // pass-through — the timeline just renders whatever survives the filter).
  const filtered = React.useMemo(() => applyFacets(events, facets), [events, facets]);
  // Derived from `filtered`, not `events`: the jump-to-error effect in
  // TranscriptTimeline only ever sees the filtered list, so the badge/button
  // must agree with what a click can actually reach.
  const errorCount = React.useMemo(() => errorEventSeqs(filtered).length, [filtered]);
  // Built from the full, unfiltered `events` — NOT `filtered` — purely for
  // display/render-mode resolution (e.g. a Read result's originating file
  // path), independent of facet state; a call and its result are now filtered
  // together (see transcript-view.ts's matchesFacet), but a call can still be
  // absent from a rendered/windowed subset for other reasons (e.g. scrolled
  // out of view) while its result remains.
  const originatingToolByResultSeq = React.useMemo(() => originatingToolByResult(events), [events]);

  const onTypeChange = React.useCallback(
    (key: keyof TranscriptFacetState["types"], value: boolean) =>
      setFacets((f) => ({ ...f, types: { ...f.types, [key]: value } })),
    [],
  );

  return (
    <div className="flex h-full flex-col">
      <TranscriptControls
        types={facets.types} onTypeChange={onTypeChange}
        tools={facets.tools} onToolsChange={(next) => setFacets((f) => ({ ...f, tools: next }))}
        toolOptions={toolOptions}
        files={facets.files} onFilesChange={(next) => setFacets((f) => ({ ...f, files: next }))}
        fileOptions={fileOptions}
        query={facets.query} onQuery={(v) => setFacets((f) => ({ ...f, query: v }))}
        errorCount={errorCount} onJumpError={() => setErrorCursor((c) => c + 1)}
      />
      <div className="min-h-0 flex-1">
        <TranscriptTimeline
          events={filtered}
          originatingToolByResultSeq={originatingToolByResultSeq}
          errorCursor={errorCursor}
        />
      </div>
    </div>
  );
}
