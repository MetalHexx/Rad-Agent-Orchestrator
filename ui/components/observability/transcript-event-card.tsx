"use client";
import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TranscriptEvent } from "@rad-orchestration/telemetry";
import { cn } from "@/lib/utils";
import { eventKindColor, eventKindLabel } from "@/lib/observability/event-kind-color";
import { formatClock, needsClamp } from "@/lib/observability/transcript-view";
import { RichText } from "./rich-text";
import { JsonBlock } from "./json-block";

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
  const revealId = `reveal-${event.seq}`;
  switch (event.kind) {
    case "message":
      // Assistant prose is rendered via RichText; clamp the source text the same
      // way when it is long enough (the markdown still renders inside the clamp).
      if (event.role === "assistant") {
        const body = event.text ?? "";
        return (
          <RevealBody id={revealId} clamp={needsClamp(body, 80)} maxHeightClass="max-h-[12.5rem]">
            <RichText body={body} variant="prose" />
          </RevealBody>
        );
      }
      return (
        <RevealBody id={revealId} clamp={needsClamp(event.text ?? "", 80)} maxHeightClass="max-h-[12.5rem]">
          <p className="whitespace-pre-wrap text-sm text-foreground">{event.text}</p>
        </RevealBody>
      );
    case "thinking":
      return (
        <RevealBody id={revealId} clamp={needsClamp(event.text ?? "", 80)} maxHeightClass="max-h-[12.5rem]">
          <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">{event.text}</p>
        </RevealBody>
      );
    case "file_change":
      return (
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="uppercase" style={{ color: "var(--model-amber)" }}>{event.file?.op}</span>
          <span className="text-foreground">{event.file?.path}</span>
        </div>
      );
    case "tool_call": {
      // Render the FULL args, wrapped — never a single horizontal-truncated line
      // (Issue 1). Past 10 wrapped rows the more/less clamp applies (Issue 2).
      const args = event.tool?.input?.text ?? "";
      return (
        <div className="font-mono text-xs">
          <span className="font-bold" style={{ color: "var(--model-teal)" }}>{event.tool?.name}</span>
          {args ? (
            <RevealBody id={revealId} clamp={needsClamp(args, 92)} maxHeightClass="max-h-[15em]">
              <JsonBlock
                text={args}
                className="mt-1"
                fallback={<span className="mt-1 block whitespace-pre-wrap break-all text-muted-foreground">{args}</span>}
              />
            </RevealBody>
          ) : null}
        </div>
      );
    }
    case "tool_result": {
      if (!showToolIO) return null;
      const isError = !!event.result?.isError;
      const out = event.result?.output;
      return (
        <div>
          {isError ? <div className="mb-1.5"><ErrorBadge /></div> : null}
          {out ? (
            <RevealBody id={revealId} clamp={needsClamp(out.text, 92)} maxHeightClass="max-h-[16.25em]">
              <JsonBlock
                text={out.text}
                className="mt-1.5 rounded-lg bg-background px-3 py-2.5"
                fallback={<CodeBlock text={out.text} error={isError} />}
              />
            </RevealBody>
          ) : null}
          {/* Truncation badge sits OUTSIDE the reveal — it reflects the data capture
              cap and must persist whether the card is collapsed or expanded. */}
          {out?.truncated ? <div className="mt-1.5"><TruncationBadge fullBytes={out.fullBytes} /></div> : null}
        </div>
      );
    }
    default:
      return event.text ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.text}</p> : null;
  }
}

// ---------------------------------------------------------------------------
// RevealBody — per-card more / less collapse (Revision 2026-06-24).
// CSS-only and SSR-safe: a hidden peer checkbox toggles the clamp via Tailwind
// `peer-checked:` sibling variants, so it renders to static HTML, holds zero
// React state, and is exercisable under renderToStaticMarkup (NFR-5). When the
// body does not overflow (`clamp` false) the children render bare — no control.
// `id` is derived from event.seq (deterministic, no Math.random).
// ---------------------------------------------------------------------------
function RevealBody({
  id, clamp, maxHeightClass, children,
}: { id: string; clamp: boolean; maxHeightClass: string; children: React.ReactNode }) {
  if (!clamp) return <>{children}</>;
  // Both <label>s are direct siblings of the peer checkbox so `peer-checked:`
  // toggles them; "more" shows collapsed, "less" shows expanded.
  const labelCls =
    "mt-1.5 inline-flex cursor-pointer select-none items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring";
  return (
    <div data-reveal="">
      <input type="checkbox" id={id} aria-label="Show more" className="peer sr-only" />
      <div
        className={cn(
          maxHeightClass,
          "overflow-hidden peer-checked:max-h-none",
          "[mask-image:linear-gradient(to_bottom,black_72%,transparent)] peer-checked:[mask-image:none]",
        )}
      >
        {children}
      </div>
      <label htmlFor={id} className={cn(labelCls, "peer-checked:hidden")}>
        more <ChevronDown className="size-3" aria-hidden="true" />
      </label>
      <label htmlFor={id} className={cn(labelCls, "hidden peer-checked:inline-flex")}>
        less <ChevronUp className="size-3" aria-hidden="true" />
      </label>
    </div>
  );
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
