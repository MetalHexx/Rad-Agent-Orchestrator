"use client";
import * as React from "react";
import type { AgentTranscript } from "@rad-orchestration/telemetry";
import { TranscriptControls } from "./transcript-controls";
import { TranscriptTimeline } from "./transcript-timeline";
import { errorEventSeqs } from "@/lib/observability/transcript-view";

export interface TranscriptFacetProps {
  transcript: AgentTranscript;
}

export function TranscriptFacet({ transcript }: TranscriptFacetProps) {
  const events = transcript.events;
  const [showThinking, setShowThinking] = React.useState(true);
  const [showToolIO, setShowToolIO] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [errorCursor, setErrorCursor] = React.useState(-1);
  const errorCount = errorEventSeqs(events).length;
  return (
    <div className="flex h-full flex-col">
      <TranscriptControls
        showThinking={showThinking} onShowThinking={setShowThinking}
        showToolIO={showToolIO} onShowToolIO={setShowToolIO}
        query={query} onQuery={setQuery}
        errorCount={errorCount} onJumpError={() => setErrorCursor((c) => c + 1)}
      />
      <div className="min-h-0 flex-1">
        <TranscriptTimeline events={events} showThinking={showThinking} showToolIO={showToolIO}
          query={query} errorCursor={errorCursor} />
      </div>
    </div>
  );
}
