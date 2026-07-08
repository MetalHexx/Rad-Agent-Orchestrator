"use client";
import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TranscriptEvent } from "@rad-orchestration/telemetry";
import { cn } from "@/lib/utils";
import { eventKindColor, eventKindLabel } from "@/lib/observability/event-kind-color";
import { formatClock, needsClamp, halfClampEm } from "@/lib/observability/transcript-view";
import { JsonBlock } from "./json-block";
import { extractToolFields, renderModeFor, type ToolField } from "@/lib/observability/render-mode";
import { MarkdownRenderer } from "@/components/documents";

export interface TranscriptEventCardProps {
  event: TranscriptEvent;
  tight?: boolean;
  /** When false, hide tool result output bodies; the call line still shows (FR-8, DD-9). */
  showToolIO?: boolean;
  /** The result's originating tool_call name (or, for a Read result, the file path it
   *  read) — the result→tool pairing seam that picks the tool_result render mode via
   *  renderModeFor, and (for Read specifically) suppresses CodeBlock's own line-number
   *  column so it doesn't double up on the `cat -n` numbers already baked into the text. */
  originatingTool?: string;
}

// A Read result's `originatingTool` is the file path it read (see render-mode.ts's
// renderModeForResult doc comment); every other raw-producing tool's `originatingTool`
// is its bare name (Bash, SendMessage, ...), which never contains a path separator or
// a dotted extension. That's the only signal available here to tell the two apart.
function isReadOrigin(originatingTool: string | undefined): boolean {
  return !!originatingTool && /[\\/]|\.[^./\\]+$/.test(originatingTool);
}

// Read-origin text carries its own `cat -n` line-number prefix baked in; strip it
// before handing the text to MarkdownRenderer so the prefix doesn't push CommonMark
// into treating every line as indented code (see isReadOrigin above for why raw mode
// suppresses CodeBlock's own gutter instead — same root cause, different render path).
function stripCatNPrefix(text: string): string {
  return text.replace(/^\s*\d+\t/gm, "");
}

type RenderChoice = "markdown" | "raw";

export function TranscriptEventCard({ event, tight = false, showToolIO = true, originatingTool }: TranscriptEventCardProps) {
  const token = eventKindColor(event);
  const defaultRenderMode = renderModeFor(event, originatingTool);
  // Seeded once from renderModeFor and never resynced — flipping this item's toggle
  // must not affect any other card, and re-renders (e.g. live SSE ticks) must not
  // snap an already-flipped card back to its default.
  const [renderChoice, setRenderChoice] = React.useState<RenderChoice>(defaultRenderMode === "raw" ? "raw" : "markdown");
  const showRenderToggle = event.kind === "message" || (event.kind === "tool_result" && showToolIO && !!event.result?.output);
  return (
    <article
      className={cn("rounded-xl bg-card ring-1 ring-foreground/10 border-l-[3px] px-4 py-3", tight ? "mt-1" : "mt-3")}
      style={{ borderLeftColor: `var(${token})` }}
    >
      <header className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: `var(${token})` }}>{eventKindLabel(event)}</span>
        <span className="flex-1" />
        {showRenderToggle ? <RenderModeToggle mode={renderChoice} onChange={setRenderChoice} /> : null}
        <time className="font-mono text-[10.5px] tabular-nums text-muted-foreground">{formatClock(event.timestamp)}</time>
      </header>
      <div className="mt-1.5">
        <EventBody event={event} showToolIO={showToolIO} originatingTool={originatingTool} renderChoice={renderChoice} />
      </div>
    </article>
  );
}

// Per-item Rendered/Raw override (wireframe `.seg`) — local to this card only.
function RenderModeToggle({ mode, onChange }: { mode: RenderChoice; onChange: (mode: RenderChoice) => void }) {
  const optionCls = (active: boolean) =>
    cn(
      "px-2 py-0.5 font-mono text-[10.5px]",
      active ? "bg-foreground/10 font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Render mode">
      <button type="button" aria-pressed={mode === "markdown"} className={optionCls(mode === "markdown")} onClick={() => onChange("markdown")}>
        Rendered
      </button>
      <button type="button" aria-pressed={mode === "raw"} className={optionCls(mode === "raw")} onClick={() => onChange("raw")}>
        Raw
      </button>
    </span>
  );
}

function EventBody({
  event, showToolIO, originatingTool, renderChoice,
}: { event: TranscriptEvent; showToolIO: boolean; originatingTool?: string; renderChoice: RenderChoice }) {
  const revealId = `reveal-${event.seq}`;
  switch (event.kind) {
    case "message": {
      const body = event.text ?? "";
      return (
        <RevealBody id={revealId} clamp={needsClamp(body, 80)} maxHeightEm={halfClampEm(body, 80)}>
          {renderChoice === "markdown" ? (
            <MarkdownRenderer content={body} />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-foreground">{body}</p>
          )}
        </RevealBody>
      );
    }
    case "thinking": {
      const body = event.text ?? "";
      return (
        <RevealBody id={revealId} clamp={needsClamp(body, 80)} maxHeightEm={halfClampEm(body, 80)}>
          <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">{body}</p>
        </RevealBody>
      );
    }
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
      const fields = event.tool ? extractToolFields(event.tool.name, args) : null;
      // Known tools render as a label/value grid; unknown tools and malformed
      // input fall back to the JsonBlock path below — nothing regresses.
      const clampSource = fields ? fields.map((f) => `${f.label}: ${f.value}`).join("\n") : args;
      return (
        <div className="font-mono text-xs">
          <span className="font-bold" style={{ color: "var(--model-teal)" }}>{event.tool?.name}</span>
          {fields ? (
            <RevealBody id={revealId} clamp={needsClamp(clampSource, 92)} maxHeightEm={halfClampEm(clampSource, 92)}>
              <ToolFieldsGrid fields={fields} />
            </RevealBody>
          ) : args ? (
            <RevealBody id={revealId} clamp={needsClamp(args, 92)} maxHeightEm={halfClampEm(args, 92)}>
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
      // `Read`-origin raw text already carries its own `cat -n` numbers baked in —
      // suppress CodeBlock's added gutter so they don't double up.
      const lineNumbers = !isReadOrigin(originatingTool);
      return (
        <div>
          {isError ? <div className="mb-1.5"><ErrorBadge /></div> : null}
          {out ? (
            <RevealBody id={revealId} clamp={needsClamp(out.text, 92)} maxHeightEm={halfClampEm(out.text, 92)} fadeTo="after:to-background">
              {renderChoice === "markdown" ? (
                <MarkdownRenderer content={isReadOrigin(originatingTool) ? stripCatNPrefix(out.text) : out.text} />
              ) : (
                <JsonBlock
                  text={out.text}
                  className="mt-1.5 rounded-lg bg-background px-3 py-2.5"
                  fallback={<CodeBlock text={out.text} error={isError} lineNumbers={lineNumbers} />}
                />
              )}
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
// RevealBody — per-card more / less collapse (Revision 2026-07-08: half-clamp).
// CSS-only and SSR-safe: a hidden peer checkbox toggles the clamp via Tailwind
// `peer-checked:` sibling variants, so it renders to static HTML, holds zero
// React state, and is exercisable under renderToStaticMarkup (NFR-5). When the
// body does not overflow (`clamp` false) the children render bare — no control.
// `id` is derived from event.seq (deterministic, no Math.random).
//
// `maxHeightEm` is computed per-body (halfClampEm) rather than a fixed class, so
// it's threaded through a CSS custom property set via `style` and consumed by a
// static arbitrary-value utility (`max-h-[var(--reveal-clamp)]`). A literal
// `style.maxHeight` can't be done here: inline styles always outrank a class-based
// rule, so `peer-checked:max-h-none` would never win and "less" would stop working.
// ---------------------------------------------------------------------------
function RevealBody({
  id, clamp, maxHeightEm, fadeTo = "after:to-card", children,
}: { id: string; clamp: boolean; maxHeightEm: number; fadeTo?: string; children: React.ReactNode }) {
  if (!clamp) return <>{children}</>;
  // Both <label>s are direct siblings of the peer checkbox so `peer-checked:`
  // toggles them; "more" shows collapsed, "less" shows expanded.
  const labelCls =
    "mt-1.5 inline-flex cursor-pointer select-none items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring";
  return (
    <div data-reveal="">
      <input type="checkbox" id={id} aria-label="Show more" className="peer sr-only" />
      {/* The collapsed fade is a gradient `::after`, NOT a CSS `mask-image`.
          `mask-image` forced this element onto a GPU mask-compositing layer that
          failed to repaint when toggled inside the scroll viewport — blanking the
          whole transcript. A plain gradient overlay paints normally. The `::after`
          rides on the clamp div (itself a peer sibling), so `peer-checked:after:hidden`
          drops the fade when expanded. `fadeTo` matches the colour behind the
          content (card for prose/args, background for tool-result code blocks). */}
      <div
        className={cn(
          "max-h-[var(--reveal-clamp)]",
          "relative overflow-hidden peer-checked:max-h-none",
          "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-12 after:bg-gradient-to-b after:from-transparent after:content-[''] peer-checked:after:hidden",
          fadeTo,
        )}
        style={{ "--reveal-clamp": `${maxHeightEm}em` } as React.CSSProperties}
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

// Label/value grid for known tool-call shapes (extractToolFields) — the item-card's
// existing tokens, reused rather than a new palette: labels reuse the JSON key
// style (heavier weight); values stay mono for code/paths, or switch to prose
// (font-sans, overriding the row's ambient font-mono) for freeform text.
function ToolFieldsGrid({ fields }: { fields: ToolField[] }) {
  return (
    <dl className="mt-1 grid grid-cols-[minmax(4.5rem,auto)_1fr] items-baseline gap-x-3 gap-y-1">
      {fields.map((f, i) => (
        <React.Fragment key={i}>
          <dt className="text-foreground font-medium">{f.label}</dt>
          <dd className={cn("whitespace-pre-wrap break-words", f.mono ? "text-muted-foreground" : "font-sans text-foreground")}>
            {f.value}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// `lineNumbers` defaults on for command/tool output that has no numbering of its
// own. `Read`-origin text already carries `cat -n` numbers, so the caller passes
// `lineNumbers={false}` there to avoid a doubled-up column.
function CodeBlock({ text, error, lineNumbers = true }: { text: string; error?: boolean; lineNumbers?: boolean }) {
  return (
    <pre
      className={cn("mt-1.5 rounded-lg px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap", !error && "bg-background")}
      style={error ? { background: "color-mix(in oklab, var(--model-red) 9%, transparent)" } : undefined}
    >
      {lineNumbers
        ? text.split("\n").map((ln, i) => (
            <div key={i} className="grid grid-cols-[2.25rem_1fr] gap-3">
              <span className="select-none text-right text-muted-foreground">{i + 1}</span>
              <span className="text-foreground">{ln}</span>
            </div>
          ))
        : text}
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
