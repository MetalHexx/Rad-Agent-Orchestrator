import * as React from "react";

export interface RichTextProps {
  /** The raw body text to render; real newlines are preserved. */
  body: string;
  /** `mono` = verbatim pre-wrap monospace (prompts, paths, JSON); `prose` = light markdown (results). */
  variant: "mono" | "prose";
  /** When set, render an inline marker noting the body was capped at capture time (DD-6). */
  truncated?: boolean;
}

// Inline formatting: **bold** and `code`. Pure — returns React nodes for SSR rendering (AD-4, AD-5).
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded bg-muted px-1.5 py-0.5 font-mono">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// A paragraph block: hard breaks within the block are preserved as <br> (DD-4).
function renderParagraph(block: string, key: string): React.ReactNode {
  const lines = block.split("\n");
  return (
    <p key={key} className="mb-3 last:mb-0">
      {lines.map((line, idx) => (
        <React.Fragment key={`${key}-l${idx}`}>
          {idx > 0 && <br />}
          {renderInline(line, `${key}-l${idx}`)}
        </React.Fragment>
      ))}
    </p>
  );
}

// Light block-level markdown: blank-line paragraphs, `-` and `1.` lists, `---` rules (DD-4).
function renderProse(body: string): React.ReactNode[] {
  return body.split(/\n\s*\n/).map((rawBlock, b) => {
    const block = rawBlock.replace(/\s+$/, "");
    if (block.trim() === "") return null;
    const key = `blk${b}`;
    if (block.trim() === "---") return <hr key={key} className="my-3 border-border" />;

    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const allOrdered = lines.length > 0 && lines.every((l) => /^\s*\d+\.\s+/.test(l));
    const allBullets = lines.length > 0 && lines.every((l) => /^\s*-\s+/.test(l));

    if (allOrdered) {
      return (
        <ol key={key} className="mb-3 list-decimal space-y-1 pl-6 last:mb-0">
          {lines.map((l, i) => (
            <li key={`${key}-i${i}`}>{renderInline(l.replace(/^\s*\d+\.\s+/, ""), `${key}-i${i}`)}</li>
          ))}
        </ol>
      );
    }
    if (allBullets) {
      return (
        <ul key={key} className="mb-3 list-disc space-y-1 pl-6 last:mb-0">
          {lines.map((l, i) => (
            <li key={`${key}-i${i}`}>{renderInline(l.replace(/^\s*-\s+/, ""), `${key}-i${i}`)}</li>
          ))}
        </ul>
      );
    }
    return renderParagraph(block, key);
  });
}

/**
 * RichText — reusable free-text body renderer for the Agent Inspector (FR-6).
 * Container-agnostic, props-only (NFR-2). `mono` keeps content verbatim; `prose`
 * applies light markdown. Dependency-free and SSR-safe (AD-5, NFR-3).
 */
export function RichText({ body, variant, truncated }: RichTextProps) {
  return (
    <div>
      {variant === "mono" ? (
        <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
          {body}
        </div>
      ) : (
        <div className="text-sm leading-relaxed text-foreground">{renderProse(body)}</div>
      )}
      {truncated && (
        <p className="mt-2 text-xs italic text-muted-foreground">… output truncated to fit the capture limit.</p>
      )}
    </div>
  );
}
