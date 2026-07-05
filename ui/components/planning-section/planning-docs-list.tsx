"use client";

import * as React from "react";
import { FileText, Image as ImageIcon, LayoutTemplate, Trash2 } from "lucide-react";
import { NodeStatusBadge } from "@/components/dag-timeline/node-status-badge";
import { SpinnerBadge, ChangeBadge } from "@/components/badges";
import { ActivePulse } from "@/components/artifacts/active-pulse";
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
 * Each row is a full click/hover target (a full-row overlay `<button>`)
 * carrying an icon badge, title, and the Requirements Draft pill, with a
 * sibling delete `<button>` — never nested inside the open control — so
 * assistive tech and keyboard nav reach both as distinct stops.
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
            <div className="relative flex items-center gap-2 py-2 pr-3 pl-3 rounded-md hover:bg-accent/50">
              {/* Primary "open" control and the delete control are sibling
                  real <button>s — never nested — so assistive tech targets
                  each correctly and Space/Enter activate natively. The open
                  button is a full-row overlay (absolute inset-0) so the whole
                  row is clickable/hoverable; the delete button comes after it
                  in DOM order so it naturally paints and receives clicks on
                  top, with no explicit z-index needed. */}
              <button
                type="button"
                aria-label={friendly}
                onClick={() => onOpen(index)}
                className="absolute inset-0 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2">
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
              </div>
              <button
                type="button"
                aria-label="Delete artifact"
                onClick={() => onDelete(artifact)}
                className="relative cursor-pointer rounded-md p-1.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </ActivePulse>
        );
      })}
    </>
  );
}
