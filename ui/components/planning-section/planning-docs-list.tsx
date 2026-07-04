"use client";

import * as React from "react";
import { FileText, Image as ImageIcon, LayoutTemplate, Trash2 } from "lucide-react";
import { NodeStatusBadge } from "@/components/dag-timeline/node-status-badge";
import { SpinnerBadge, ChangeBadge } from "@/components/badges";
import { ActivePulse } from "@/components/artifacts/active-pulse";
import { cn } from "@/lib/utils";
import type { Artifact, ArtifactKind } from "@/lib/artifact-model";

const PLANNING_TIER = "--tier-planning";

function iconFor(kind: ArtifactKind): React.ReactNode {
  if (kind === "markdown") return <FileText size={12} aria-hidden="true" />;
  if (kind === "visual" || kind === "html") return <ImageIcon size={12} aria-hidden="true" />;
  return <LayoutTemplate size={12} aria-hidden="true" />;
}

/**
 * True only for the Requirements row while its doc is still in draft — the
 * sole condition under which the inline "Draft" pill renders. Any other
 * status (`approved`, an unrecognized value, or `null`) renders nothing.
 */
export function showsDraftBadge(artifact: Artifact, requirementsStatus: string | null): boolean {
  return artifact.category === "requirements" && requirementsStatus === "draft";
}

export interface PlanningDocsListProps {
  /** Already ordered by `deriveArtifacts` (pinned docs first) — consumed as-is, never re-sorted here. */
  artifacts: Artifact[];
  requirementsStatus: string | null;
  onOpen: (index: number) => void;
  onDelete: (artifact: Artifact) => void;
  unseen?: Set<string>;
  activePulse?: Set<string>;
}

/**
 * Left-column list of the ordered Planning-section root documents. Purely
 * presentational — it does no fetching, sorting, or fs access; the caller
 * (fed by `deriveArtifacts` + the Requirements status endpoint) owns that.
 * Each row carries an icon badge with sibling open/delete `<button>`s
 * (roving-tabindex-friendly), a muted type label, and the Requirements
 * Draft pill.
 */
export function PlanningDocsList({ artifacts, requirementsStatus, onOpen, onDelete, unseen, activePulse }: PlanningDocsListProps) {
  if (artifacts.length === 0) return null;
  return (
    <>
      {artifacts.map((artifact, index) => {
        const friendly = artifact.title ?? artifact.label;
        const isUnseen = unseen?.has(artifact.fileName) ?? false;
        const isActive = activePulse?.has(artifact.fileName) ?? false;
        const showDraft = showsDraftBadge(artifact, requirementsStatus);
        return (
          <ActivePulse key={artifact.fileName} active={isActive} variant="row">
            <div className="flex items-center gap-2 py-2 pr-3 pl-3 rounded-md hover:bg-accent/50">
              {/* Primary "open" control and the delete control are sibling
                  real <button>s — never nested — so assistive tech targets
                  each correctly and Space/Enter activate natively. */}
              <button
                type="button"
                aria-label={`${friendly} — ${artifact.label}`}
                onClick={() => onOpen(index)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 cursor-pointer text-left rounded-md",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {isUnseen ? (
                  <ChangeBadge />
                ) : (
                  <NodeStatusBadge
                    status="completed"
                    label={artifact.label}
                    cssVar={PLANNING_TIER}
                    iconOnly
                    icon={iconFor(artifact.kind)}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{friendly}</span>
                {showDraft && (
                  <SpinnerBadge label="Draft" cssVar={PLANNING_TIER} isSpinning={false} />
                )}
              </button>
              <div className="flex min-w-0 shrink-0 items-center gap-3">
                <span title={artifact.fileName} className="truncate text-xs text-muted-foreground">
                  {artifact.label}
                </span>
                <button
                  type="button"
                  aria-label="Delete artifact"
                  onClick={() => onDelete(artifact)}
                  className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </ActivePulse>
        );
      })}
    </>
  );
}
