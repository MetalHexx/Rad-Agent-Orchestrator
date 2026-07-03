"use client";

import { FileText } from "lucide-react";
import { NodeStatusBadge } from "./node-status-badge";
import { cn } from "@/lib/utils";

const PLANNING_TIER = "--tier-planning";

export interface RequirementsPlanningRowProps {
  /** Bare `${project}-REQUIREMENTS.md` filename, forwarded verbatim to onDocClick. */
  fileName: string;
  onDocClick: (path: string) => void;
}

/**
 * Static authored-badge row for the Requirements doc. Unlike DAGNodeRow this
 * has no pipeline status to reflect — Requirements is authored pre-pipeline
 * (no state node since PLANNING-OVERHAUL-1) — so the badge is a fixed
 * "completed" check, never a spinner. Deliberately left out of the timeline's
 * roving-focus set (no `data-timeline-row` / `data-row-key`): normal Tab
 * order plus click is sufficient for a static artifact.
 */
export function RequirementsPlanningRow({ fileName, onDocClick }: RequirementsPlanningRowProps) {
  return (
    <div className="flex items-center gap-2 py-2 pr-3 pl-3 rounded-md hover:bg-accent/50">
      <button
        type="button"
        aria-label="Requirements — authored"
        onClick={() => onDocClick(fileName)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 cursor-pointer text-left rounded-md",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <NodeStatusBadge
          status="completed"
          label="Requirements"
          cssVar={PLANNING_TIER}
          iconOnly
          icon={<FileText size={12} aria-hidden="true" />}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Requirements</span>
      </button>
    </div>
  );
}
