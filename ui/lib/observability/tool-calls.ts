// Pure, SSR-safe derivations for the Tools facet. No React, no DOM —
// mirrors the helper style in transcript-view.ts (e.g. errorEventSeqs).
import type { TranscriptEvent, TruncatableBody } from "@rad-orchestration/telemetry";

export interface ToolCall {
  seq: number;                    // callEvent.seq — ordinal source + stable expansion/React key
  name: string;                   // callEvent.tool.name
  input: TruncatableBody;         // callEvent.tool.input (snippet + search source)
  isError: boolean;               // resultEvent?.result.isError ?? false
  callEvent: TranscriptEvent;     // the tool_call event (handed to TranscriptEventCard)
  resultEvent?: TranscriptEvent;  // matched tool_result; absent when still running
}

// Pair each tool_call to the tool_result with the same toolUseId. The id is
// used only for the join and is never surfaced to the UI (AD-6).
export function toToolCalls(events: TranscriptEvent[]): ToolCall[] {
  const resultByUseId = new Map<string, TranscriptEvent>();
  for (const e of events) {
    if (e.kind === "tool_result" && e.result) resultByUseId.set(e.result.toolUseId, e);
  }
  const calls: ToolCall[] = [];
  for (const ev of events) {
    if (ev.kind !== "tool_call" || !ev.tool) continue;
    const resultEvent = resultByUseId.get(ev.tool.toolUseId);
    calls.push({
      seq: ev.seq,
      name: ev.tool.name,
      input: ev.tool.input,
      isError: resultEvent?.result?.isError ?? false,
      callEvent: ev,
      resultEvent,
    });
  }
  return calls;
}

export interface ToolCallFilter {
  toolFilter: string | null; // exact tool name, or null = all tools
  errorsOnly: boolean;
  query: string;
}

export function filterToolCalls(calls: ToolCall[], f: ToolCallFilter): ToolCall[] {
  const q = f.query.trim().toLowerCase();
  return calls.filter((c) => {
    if (f.toolFilter && c.name !== f.toolFilter) return false;
    if (f.errorsOnly && !c.isError) return false;
    if (q !== "" && !c.input.text.toLowerCase().includes(q)) return false;
    return true;
  });
}
