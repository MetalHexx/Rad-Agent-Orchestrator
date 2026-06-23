"use client";
import * as React from "react";
import { useSSEContext } from "@/hooks/use-sse-context";
import type { SSEEvent } from "@/types/events";

/** Pure match seam: true iff this event is a transcript_change for the open session. */
export function transcriptChangeMatches(event: SSEEvent, sessionId: string): boolean {
  return event.type === 'transcript_change'
    && (event.payload as { sessionId?: string }).sessionId === sessionId;
}

/** Subscribe to transcript_change over the shared SSE multiplexer; debounce-coalesce
 *  a burst into one onChange so the open transcript re-renders at most once (NFR-7). */
export function useTranscriptLive(sessionId: string | null, onChange: () => void): void {
  const { subscribe } = useSSEContext();
  const cbRef = React.useRef(onChange);
  cbRef.current = onChange;
  React.useEffect(() => {
    if (!sessionId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = subscribe((event) => {
      if (!transcriptChangeMatches(event, sessionId)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), 50);
    });
    return () => { if (timer) clearTimeout(timer); off(); };
  }, [sessionId, subscribe]);
}
