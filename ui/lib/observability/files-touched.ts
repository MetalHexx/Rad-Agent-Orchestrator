// Pure, SSR-safe derivation for the Files facet. No React, no DOM — mirrors
// toToolCalls (tool-calls.ts): group the agent's file_change events by path,
// attaching each to its owning Edit/Write call + result by adjacency (AD-1, AD-2).
import type { TranscriptEvent } from "@rad-orchestration/telemetry";

export type FileOp = "edit" | "write" | "snapshot";

export interface FileChange {
  seq: number;                    // file_change event seq — stable React key for the change
  op: FileOp;
  callEvent?: TranscriptEvent;    // owning Edit/Write tool_call (adjacency), handed to TranscriptEventCard
  resultEvent?: TranscriptEvent;  // matched tool_result; absent when still running
}

export interface FileTouched {
  path: string;
  ops: FileOp[];                  // distinct ops, first-seen order
  changes: FileChange[];
}

// Group file_change events by path, preserving first-seen path order so the
// list matches transcript.filesTouched. The owning call is the most recent
// tool_call before the file_change (the parser emits them adjacently); its
// result is joined by toolUseId. toolUseId is used only for the join (AD-2).
export function toFilesTouched(events: TranscriptEvent[]): FileTouched[] {
  const resultByUseId = new Map<string, TranscriptEvent>();
  for (const e of events) {
    if (e.kind === "tool_result" && e.result) resultByUseId.set(e.result.toolUseId, e);
  }
  const byPath = new Map<string, FileTouched>();
  const order: string[] = [];
  let lastCall: TranscriptEvent | undefined;
  for (const ev of events) {
    if (ev.kind === "tool_call") { lastCall = ev; continue; }
    if (ev.kind !== "file_change" || !ev.file) continue;
    const callEvent = lastCall;
    const resultEvent = callEvent?.tool ? resultByUseId.get(callEvent.tool.toolUseId) : undefined;
    const change: FileChange = { seq: ev.seq, op: ev.file.op, callEvent, resultEvent };
    let entry = byPath.get(ev.file.path);
    if (!entry) { entry = { path: ev.file.path, ops: [], changes: [] }; byPath.set(ev.file.path, entry); order.push(ev.file.path); }
    entry.changes.push(change);
    if (!entry.ops.includes(change.op)) entry.ops.push(change.op);
  }
  return order.map((p) => byPath.get(p)!);
}
