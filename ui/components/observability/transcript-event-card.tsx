"use client";
import * as React from "react";
import type { TranscriptEvent } from "@rad-orchestration/telemetry";
import { cn } from "@/lib/utils";
import { eventKindColor, eventKindLabel } from "@/lib/observability/event-kind-color";
import { formatClock } from "@/lib/observability/transcript-view";
import { RichText } from "./rich-text";

export interface TranscriptEventCardProps {
  event: TranscriptEvent;
  /** Reduced top margin when this card is a result paired to the call above it (DD-7). */
  tight?: boolean;
}

export function TranscriptEventCard({ event, tight = false }: TranscriptEventCardProps) {
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
        <EventBody event={event} />
      </div>
    </article>
  );
}

function EventBody({ event }: { event: TranscriptEvent }) {
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
    default:
      return event.text ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.text}</p> : null;
  }
}
