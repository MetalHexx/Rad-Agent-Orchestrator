"use client";
import * as React from "react";
import { FileEdit, FilePlus, FileSearch } from "lucide-react";
import type { AgentTranscript } from "@rad-orchestration/telemetry";
import { toFilesTouched } from "@/lib/observability/files-touched";
import { FilesTouchedList } from "./files-touched-list";

const CARD = "rounded-xl bg-card ring-1 ring-foreground/10"; // Overview recipe, no colored left edge (DD-1, DD-2)

export interface FilesFacetProps {
  /** Already-fetched transcript — read directly each render, no fetch, no snapshot (AD-3, NFR-1, NFR-2). */
  transcript: AgentTranscript;
}

export function FilesFacet({ transcript }: FilesFacetProps) {
  const [expanded, setExpanded] = React.useState<Set<number>>(() => new Set());

  // Derive on every render; each SSE refetch replaces the transcript object so
  // transcript.events is a fresh ref and this memo recomputes — live by props (AD-3, FR-7, NFR-2).
  const files = React.useMemo(() => toFilesTouched(transcript.events), [transcript.events]);

  const toggle = React.useCallback((seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });
  }, []);

  // created = any path with a write op; edited = the rest. Sums to files.length (DD-6).
  const created = files.filter((f) => f.ops.includes("write")).length;
  const edited = files.length - created;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="flex flex-col gap-4">
        <section className={CARD}>
          {files.length === 0 ? (
            /* Read-only empty state — the only fully-new visual (FR-5, DD-7). The absent
               "no transcript" case is owned by the modal container, not this facet (AD-5). */
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-xl bg-muted">
                <FileSearch className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <span className="text-sm font-medium text-foreground">No files changed</span>
              <span className="max-w-sm text-xs text-muted-foreground">
                This was a read-only agent — it inspected the codebase but never wrote to disk.
              </span>
              <span className="mt-2 max-w-sm border-t border-dashed border-border pt-2 text-[11px] text-muted-foreground">
                A transcript was captured; this agent&apos;s file list is genuinely empty — distinct from &ldquo;no transcript captured.&rdquo;
              </span>
            </div>
          ) : (
            <>
              {/* Header with right-aligned op summary; no separate breakdown card (DD-6, DD-8). */}
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h3 className="text-sm font-medium text-foreground">Files changed</h3>
                <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                  <b className="font-semibold text-foreground">{files.length}</b> files
                  <span className="px-1 text-border" aria-hidden="true">·</span>
                  <FilePlus className="size-3.5" aria-hidden="true" />
                  <b className="font-semibold text-foreground">{created}</b> created
                  <span className="px-1 text-border" aria-hidden="true">·</span>
                  <FileEdit className="size-3.5" aria-hidden="true" />
                  <b className="font-semibold text-foreground">{edited}</b> edited
                </span>
              </div>
              <FilesTouchedList files={files} expanded={expanded} onToggle={toggle} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
