"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import type { AgentTranscript } from "@rad-orchestration/telemetry";
import { tokenizeJson } from "@/lib/observability/pretty-json";
import { copyTextToClipboard } from "@/lib/clipboard";
import { JsonTokens } from "./json-block";

// ---------------------------------------------------------------------------
// RawTranscriptView — prettified, syntax-highlighted JSON view of an AgentTranscript (FR-7)
//
// Container-agnostic: renders only a <pre> + toolbar using house tokens (NFR-4, NFR-6).
// No live-update flash (DD-8): the earlier whole-content animate-pulse dimmed the
// entire JSON on every SSE tick, so it was removed entirely (no replacement cue).
// ---------------------------------------------------------------------------

export interface RawTranscriptViewProps {
  transcript: AgentTranscript;
  /** The file name / identifier shown in the toolbar (DD-4). */
  file: string;
}

export function RawTranscriptView({ transcript, file }: RawTranscriptViewProps) {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = React.useCallback(async () => {
    const text = JSON.stringify(transcript, null, 2);
    const ok = await copyTextToClipboard(text);
    setCopyState(ok ? 'copied' : 'failed');
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState('idle'), 2000);
  }, [transcript]);

  React.useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const tokens = React.useMemo(() => tokenizeJson(transcript), [transcript]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar — shows file identifier and copy-JSON button (DD-4) */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-3 py-2">
        <span
          className="truncate text-xs text-muted-foreground"
          title={file}
        >
          {file}
        </span>
        <button
          type="button"
          aria-label="Copy JSON"
          onClick={handleCopy}
          className="ml-2 flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copyState === 'copied' ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}
        </button>
      </div>

      {/* Scroll container (NFR-6 — container-agnostic, fills parent) */}
      <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
        <JsonTokens tokens={tokens} aria-label="Raw transcript JSON" />
      </div>
    </div>
  );
}
