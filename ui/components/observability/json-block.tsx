"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { tryTokenizeJson, type JsonToken } from "@/lib/observability/pretty-json";

// ---------------------------------------------------------------------------
// JsonBlock — pretty-prints tool I/O when it is structured JSON, else falls back.
//
// Tool call args and results are stored as pre-stringified, compact JSON, so the
// raw render shows escaped `\n` soup. This re-parses + re-indents via the same
// house tokenizer the Raw view uses (tokenizeJson → JSON.stringify(_, null, 2)),
// so valid JSON renders indented + syntax-highlighted by default. Non-JSON text
// (bash output, prose, truncated bodies) returns null from tryTokenizeJson and
// renders the supplied `fallback` verbatim — zero regression.
//
// SSR-safe / renderToStaticMarkup-friendly: no effects, deterministic output.
// ---------------------------------------------------------------------------

/** Shared rendering shape for tokenized JSON — also used by RawTranscriptView. */
export function JsonTokens({
  tokens,
  className,
  "aria-label": ariaLabel,
}: {
  tokens: JsonToken[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <pre
      className={cn("font-mono text-xs leading-relaxed whitespace-pre-wrap break-words", className)}
      aria-label={ariaLabel}
    >
      {tokens.map((tok, idx) => (
        <span key={idx} className={tok.className}>
          {tok.text}
        </span>
      ))}
    </pre>
  );
}

export interface JsonBlockProps {
  text: string;
  /** Rendered verbatim when `text` is not structured JSON. */
  fallback: React.ReactNode;
  className?: string;
}

export function JsonBlock({ text, fallback, className }: JsonBlockProps) {
  const tokens = React.useMemo(() => tryTokenizeJson(text), [text]);
  if (!tokens) return <>{fallback}</>;
  return <JsonTokens tokens={tokens} className={className} />;
}
