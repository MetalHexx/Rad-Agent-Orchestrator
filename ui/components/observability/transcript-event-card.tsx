"use client";
import * as React from "react";
import type { TranscriptEvent } from "@rad-orchestration/telemetry";
import { cn } from "@/lib/utils";
import { eventKindColor, eventKindLabel } from "@/lib/observability/event-kind-color";
import { formatClock, toolArgPreview } from "@/lib/observability/transcript-view";
import { RichText } from "./rich-text";

export interface TranscriptEventCardProps {
  event: TranscriptEvent;
  tight?: boolean;
  /** When false, hide tool result output bodies; the call line still shows (FR-8, DD-9). */
  showToolIO?: boolean;
}

export function TranscriptEventCard({ event, tight = false, showToolIO = true }: TranscriptEventCardProps) {
  const token = eventKindColor(event);
  return (
    <article
      className={cn("rounded-xl bg-card ring-1 ring-foreground/10 border-l-[3px] px-4 py-3", tight ? "mt-1" : "mt-3")}
      style={{ borderLeftColor: `var(${token})` }}
    >
      <header className="flex items-center justify-between">
        <span className="text-[11px] font-semibold" style={{ color: `var(${token})` }}>{eventKindLabel(event)}</span>
        <time className="font-mono text-[10.5px] tabular-nums text-muted-foreground">{formatClock(event.timestamp)}</time>
      </header>
      <div className="mt-1.5">
        <EventBody event={event} showToolIO={showToolIO} />
      </div>
    </article>
  );
}

function EventBody({ event, showToolIO }: { event: TranscriptEvent; showToolIO: boolean }) {
  switch (event.kind) {
    case "message":
      return event.role === "assistant"
        ? <RichText body={event.text ?? ""} variant="prose" />
        : <p className="whitespace-pre-wrap text-sm text-foreground">{event.text}</p>;
    case "thinking":
      return <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">{event.text}</p>;
    case "file_change":
      return (
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="uppercase" style={{ color: "var(--model-amber)" }}>{event.file?.op}</span>
          <span className="text-foreground">{event.file?.path}</span>
        </div>
      );
    case "tool_call":
      return (
        <div className="font-mono text-xs">
          <span className="font-bold" style={{ color: "var(--model-teal)" }}>{event.tool?.name}</span>
          {event.tool?.input?.text ? <span className="text-muted-foreground"> {toolArgPreview(event.tool.input.text)}</span> : null}
        </div>
      );
    case "tool_result": {
      if (!showToolIO) return null;
      const isError = !!event.result?.isError;
      const out = event.result?.output;
      return (
        <div>
          {isError ? <div className="mb-1.5"><ErrorBadge /></div> : null}
          {out ? <CodeBlock text={out.text} error={isError} /> : null}
          {out?.truncated ? <div className="mt-1.5"><TruncationBadge fullBytes={out.fullBytes} /></div> : null}
        </div>
      );
    }
    default:
      return event.text ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.text}</p> : null;
  }
}

function CodeBlock({ text, error }: { text: string; error?: boolean }) {
  const lines = text.split("\n");
  return (
    <pre
      className={cn("mt-1.5 rounded-lg px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap", !error && "bg-background")}
      style={error ? { background: "color-mix(in oklab, var(--model-red) 9%, transparent)" } : undefined}
    >
      {lines.map((ln, i) => (
        <div key={i} className="grid grid-cols-[2.25rem_1fr] gap-3">
          <span className="select-none text-right text-muted-foreground">{i + 1}</span>
          <span className="text-foreground">{ln}</span>
        </div>
      ))}
    </pre>
  );
}

function TruncationBadge({ fullBytes }: { fullBytes?: number }) {
  const size = fullBytes ? `${Math.max(1, Math.round(fullBytes / 1024))} KB` : "capped";
  return (
    <span className="inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px]"
      style={{ color: "var(--color-warning)", borderColor: "var(--color-warning)", background: "color-mix(in oklab, var(--color-warning) 8%, transparent)" }}>
      truncated · {size}
    </span>
  );
}

function ErrorBadge() {
  return (
    <span className="inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px]"
      style={{ color: "var(--model-red)", borderColor: "var(--color-error-border)", background: "color-mix(in oklab, var(--model-red) 9%, transparent)" }}>
      error
    </span>
  );
}
