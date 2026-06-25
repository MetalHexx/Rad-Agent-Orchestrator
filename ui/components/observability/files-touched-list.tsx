"use client";
import * as React from "react";
import { ChevronDown, FileEdit, FilePlus, FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TranscriptEventCard } from "./transcript-event-card";
import type { FileOp, FileTouched } from "@/lib/observability/files-touched";

const OPEN_TINT = "bg-[color:color-mix(in_srgb,var(--chart-2)_8%,transparent)]"; // open-row tint (DD-4)

const OP_ICON: Record<FileOp, React.ComponentType<{ className?: string }>> = {
  edit: FileEdit,
  write: FilePlus,
  snapshot: FileIcon, // defensive only — the live parser emits edit/write (DD-3)
};

export interface FilesTouchedListProps {
  files: FileTouched[];
  expanded: Set<number>;          // open row keys (each row's first-change seq) — multi-open (FR-3)
  onToggle: (seq: number) => void;
}

export function FilesTouchedList({ files, expanded, onToggle }: FilesTouchedListProps) {
  if (files.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No files changed.</p>;
  }
  return (
    <div role="list" aria-label="Files changed">
      {files.map((file) => {
        const rowSeq = file.changes[0].seq;
        return <FileRow key={rowSeq} file={file} open={expanded.has(rowSeq)} onToggle={() => onToggle(rowSeq)} />;
      })}
    </div>
  );
}

function FileRow({ file, open, onToggle }: { file: FileTouched; open: boolean; onToggle: () => void }) {
  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const base = slash >= 0 ? file.path.slice(slash + 1) : file.path;
  return (
    <div role="listitem" className={cn("border-b border-border", open && OPEN_TINT)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-2 text-left",
          "hover:bg-[color:color-mix(in_srgb,var(--foreground)_3%,transparent)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {/* Grey identity badges — color is reserved for the expansion (DD-3) */}
        <span className="flex shrink-0 items-center gap-1">
          {file.ops.map((op) => {
            const Icon = OP_ICON[op];
            return (
              <Badge key={op} variant="secondary" className="gap-1 font-mono">
                <Icon className="size-3" />
                {op}
              </Badge>
            );
          })}
        </span>
        {/* Path — directory dimmed, basename bright, truncate (DD-4) */}
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          <span className="text-muted-foreground">{dir}</span>
          <span className="text-foreground">{base}</span>
        </span>
        {file.changes.length > 1 ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">×{file.changes.length}</span>
        ) : null}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div className={cn("px-4 pb-3", OPEN_TINT)}>
          {/* Per change, in order: step label + reused call/result cards (DD-5). Bodies
              honor the existing capture/truncation cap via TranscriptEventCard (NFR-3). */}
          {file.changes.map((change, i) => (
            <div key={change.seq} className="pt-2">
              <div className="mb-1 border-t border-border pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                change {i + 1} · {change.op}
              </div>
              {change.callEvent ? <TranscriptEventCard event={change.callEvent} /> : null}
              {change.resultEvent ? <TranscriptEventCard event={change.resultEvent} tight showToolIO /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
