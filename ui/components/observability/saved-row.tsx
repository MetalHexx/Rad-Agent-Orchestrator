"use client";
import * as React from "react";
import { useState } from "react";
import { Pencil, Save } from "lucide-react";
import type { SavedSession } from "@rad-orchestration/telemetry";
import { humanizeTokens } from "@/lib/observability/format";
import { formatDuration } from "@/lib/observability/duration-format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SaveStarButton } from "@/components/observability/save-star-button";
import { renameSaved } from "@/lib/observability/saved-client";

export interface SavedRowProps {
  session: SavedSession;
  selected?: boolean;
  isBaseline?: boolean;
  onSelect?: (sessionId: string, checked: boolean) => void;
  onUnsave?: (sessionId: string) => void;
  onRenamed?: (updated: SavedSession) => void;
}

/**
 * Row in the Saved Benchmarks table: [checkbox · star · Title · Saved · Spend · Duration].
 * Title is shown monospace when it equals the session id (i.e. user has not renamed it).
 * Spend uses humanizeTokens; Duration uses formatDuration (same helpers as SessionTable).
 * Selected rows apply the --live accent for highlight (FR-4, DD-3, DD-9).
 */
export function SavedRow({ session, selected = false, isBaseline = false, onSelect, onUnsave, onRenamed }: SavedRowProps) {
  const { sessionId, title, savedAt, snapshot } = session;
  const titleIsSid = title === sessionId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  const commit = async () => {
    const r = await renameSaved(session.sessionId, draft);
    if (r) { setEditing(false); onRenamed?.(r); }
  };

  return (
    <div
      role="row"
      className={cn(
        "grid grid-cols-[2rem_2rem_1fr_10rem_7rem_6rem] items-center gap-x-3 px-4 py-2 border-b border-border last:border-0 hover:bg-muted/70 transition-colors text-sm",
        selected && "bg-[color:var(--live)]/10 ring-inset ring-1 ring-[color:var(--live)]/40"
      )}
    >
      {/* Checkbox */}
      <div role="gridcell" className="flex items-center justify-center">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${title}`}
          onChange={(e) => onSelect?.(sessionId, e.currentTarget.checked)}
          className="accent-[var(--live)] size-4"
        />
      </div>

      {/* Star — always filled because the session is already saved */}
      <div role="gridcell" className="flex items-center justify-center">
        <SaveStarButton saved onToggle={() => onUnsave?.(sessionId)} />
      </div>

      {/* Title — mono when still equal to the session id; pencil to enter rename mode */}
      <div role="gridcell" className="flex items-center gap-1 min-w-0">
        {isBaseline && (
          <Badge variant="accent" className="shrink-0">BASELINE</Badge>
        )}
        {editing ? (
          <>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="bg-transparent border border-border rounded px-1 font-mono text-sm min-w-0 flex-1"
              aria-label="Benchmark title"
            />
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Save title"
              title="Save"
              onClick={commit}
              className="text-muted-foreground hover:text-[var(--chart-2)]"
            >
              <Save aria-hidden="true" />
            </Button>
          </>
        ) : (
          <>
            <span
              className={cn(
                "truncate",
                titleIsSid ? "font-mono text-xs text-muted-foreground" : "text-foreground"
              )}
              title={title}
            >
              {title}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Rename benchmark"
              title="Rename"
              onClick={() => { setDraft(session.title); setEditing(true); }}
              className="text-muted-foreground hover:text-[var(--chart-2)]"
            >
              <Pencil aria-hidden="true" />
            </Button>
          </>
        )}
      </div>

      {/* Saved date */}
      <div role="gridcell" className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
        {new Date(savedAt).toLocaleString()}
      </div>

      {/* Spend */}
      <div role="gridcell" className="whitespace-nowrap text-sm font-semibold tabular-nums">
        {humanizeTokens(snapshot.totalSpend)}
      </div>

      {/* Duration */}
      <div role="gridcell" className="whitespace-nowrap text-xs tabular-nums">
        {formatDuration(snapshot.durationMs)}
      </div>
    </div>
  );
}
