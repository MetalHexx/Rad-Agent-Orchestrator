// Kind → house color/label map (mirror of model-color.ts). Returns token NAMES only;
// components render var(<token>). One typed place so renderers stay declarative.
import type { TranscriptEvent } from "@rad-orchestration/telemetry";

export const KIND_TOKENS = [
  "--model-grey", "--chart-2", "--model-purple",
  "--model-teal", "--model-green", "--model-red", "--model-amber",
] as const;
export type KindToken = (typeof KIND_TOKENS)[number];

export function eventKindColor(event: TranscriptEvent): KindToken {
  switch (event.kind) {
    case "message": return event.role === "assistant" ? "--chart-2" : "--model-grey";
    case "thinking": return "--model-purple";
    case "tool_call": return "--model-teal";
    case "tool_result": return event.result?.isError ? "--model-red" : "--model-green";
    case "file_change": return "--model-amber";
    default: return "--model-grey"; // system, hook, unknown → neutral fallback
  }
}

export function eventKindLabel(event: TranscriptEvent): string {
  switch (event.kind) {
    case "message": return event.role === "assistant" ? "Assistant" : "User";
    case "thinking": return "Thinking";
    case "tool_call": return "Tool call";
    case "tool_result": return event.result?.isError ? "Result · error" : "Result";
    case "file_change": return "File change";
    case "system": return "System";
    case "hook": return "Hook";
    default: return "Event";
  }
}
