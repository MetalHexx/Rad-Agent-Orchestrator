// Pure, SSR-safe render-mode decision + structured tool-call field extraction.
// No React, no DOM — mirrors the helper style in transcript-view.ts.
import type { TranscriptEvent } from "@rad-orchestration/telemetry";

export type RenderMode = "markdown" | "raw" | "structured";

export interface ToolField {
  label: string;
  value: string;
  /** True renders the value in the mono/code style; omitted/false renders prose. */
  mono?: boolean;
}

// tool_result originating tools whose output reads as prose (a subagent's final
// report) rather than command/file output — rendered as markdown, not raw.
const PROSE_RESULT_TOOLS = new Set(["Agent", "Task"]);

function isMarkdownPath(pathOrTool: string): boolean {
  return /\.mdx?$/i.test(pathOrTool.trim());
}

// `originatingTool` is either a bare tool name (Bash, Agent, Task, ...) or, for a
// Read result specifically, the file path that call read — the one case where the
// tool name alone can't decide the mode (Read of *.md vs Read of a source file).
function renderModeForResult(originatingTool: string | undefined): RenderMode {
  if (!originatingTool) return "raw";
  if (PROSE_RESULT_TOOLS.has(originatingTool)) return "markdown";
  if (isMarkdownPath(originatingTool)) return "markdown";
  return "raw";
}

/**
 * Classifies how a transcript item should render: `structured` (label/value
 * grid), `markdown` (prose), or `raw` (plain/code). Decided purely from the
 * event's kind and, for `tool_result`, the originating tool/path — never by
 * sniffing the event's own text (a renamed tool or localized prose would
 * silently misclassify a content-based rule).
 */
export function renderModeFor(event: TranscriptEvent, originatingTool?: string): RenderMode {
  switch (event.kind) {
    case "tool_call":
      return "structured";
    case "message":
      return "markdown";
    case "thinking":
      return "raw";
    case "tool_result":
      return renderModeForResult(originatingTool);
    default:
      return "raw";
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): string | undefined {
  return typeof v === "number" ? String(v) : str(v);
}

function preview(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

function fieldsOf(entries: Array<[label: string, value: string | undefined, mono?: boolean]>): ToolField[] | null {
  const out: ToolField[] = [];
  for (const [label, value, mono] of entries) {
    if (value !== undefined) out.push({ label, value, mono });
  }
  return out.length > 0 ? out : null;
}

/**
 * Pulls the salient fields out of a tool call's `input.text` (a JSON string) for
 * the known orchestrator/harness tool shapes. Returns `null` for an unrecognized
 * tool name, unparsable JSON, or a recognized tool with none of its fields present
 * — every case where the card should fall back to the raw `JsonBlock` instead of
 * rendering a blank grid.
 */
export function extractToolFields(name: string, inputText: string): ToolField[] | null {
  let input: unknown;
  try {
    input = JSON.parse(inputText);
  } catch {
    return null;
  }
  if (typeof input !== "object" || input === null) return null;
  const obj = input as Record<string, unknown>;

  switch (name) {
    case "Read":
    case "Write":
      return fieldsOf([["File", str(obj.file_path), true]]);
    case "Edit": {
      const oldStr = str(obj.old_string);
      const newStr = str(obj.new_string);
      const change = oldStr !== undefined || newStr !== undefined
        ? `${preview(oldStr ?? "")} → ${preview(newStr ?? "")}`
        : undefined;
      return fieldsOf([["File", str(obj.file_path), true], ["Change", change, true]]);
    }
    case "Bash":
      return fieldsOf([["Command", str(obj.command), true], ["Description", str(obj.description)]]);
    case "Agent":
      return fieldsOf([
        ["Subagent", str(obj.subagent_type)],
        ["Description", str(obj.description)],
        ["Prompt", str(obj.prompt)],
      ]);
    case "SendMessage":
      return fieldsOf([["To", str(obj.to)], ["Summary", str(obj.summary)]]);
    case "Skill":
      return fieldsOf([["Skill", str(obj.skill) ?? str(obj.name)]]);
    case "ToolSearch":
      return fieldsOf([["Query", str(obj.query), true], ["Max results", num(obj.max_results ?? obj.maxResults)]]);
    default:
      return null;
  }
}
