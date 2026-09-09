"use client";

import * as React from "react";
import { ArtifactTile } from "@/components/artifacts";
import { useArtifactLive } from "@/hooks/use-artifact-live";
import { useSessionJourney } from "@/hooks/use-session-journey";
import { SessionJourney } from "@/components/session-journey";
import { DAGTimelineSkeleton } from "@/components/dag-timeline/dag-timeline-skeleton";
import { SECTION_LABEL_CLASSES } from "@/components/dag-timeline/dag-section-group";
import type { Artifact } from "@/lib/artifact-model";

export interface OverviewPageProps {
  projectName: string;
  onOpenArtifact: (index: number) => void;
  onDeleteArtifact: (artifact: Artifact) => void;
}

/**
 * The Overview: every project's landing page, reachable whether or not a
 * pipeline exists. Two sections in a fixed order — Documents, then Session
 * Journey — with no page-level primary action; re-entry into a session is
 * per row, inside `SessionCard` itself. Reads `ArtifactLiveProvider` and the
 * session-journey endpoint directly, so the caller only threads through the
 * artifact-modal-open and artifact-delete wiring it already owns.
 *
 * The two sections fetch independently, so this renders the shared
 * `DAGTimelineSkeleton` — the same placeholder the caller shows before this
 * component mounts at all — until BOTH the artifact snapshot and the session
 * journey have settled. Gating on the artifact snapshot alone let the journey
 * flash its "no sessions" empty state for a beat before its own fetch landed.
 */
export function OverviewPage({ projectName, onOpenArtifact, onDeleteArtifact }: OverviewPageProps) {
  const live = useArtifactLive();
  const journey = useSessionJourney(projectName);

  if (!live.snapshotLoaded || !journey.loaded) {
    return <DAGTimelineSkeleton />;
  }

  return (
    <>
      <div role="group" aria-label="Documents section">
        <div aria-hidden="true" className={SECTION_LABEL_CLASSES}>Documents</div>
        {live.artifacts.length > 0 && (
          <div className="flex flex-wrap gap-3.5">
            {live.artifacts.map((artifact, index) => (
              <div key={artifact.fileName} className="w-44">
                <ArtifactTile
                  projectName={projectName}
                  artifact={artifact}
                  onOpen={() => onOpenArtifact(index)}
                  onDelete={() => onDeleteArtifact(artifact)}
                  unseen={live.unseen.has(artifact.fileName)}
                  activePulse={live.activePulse.has(artifact.fileName)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <SessionJourney
        projectName={projectName}
        sessions={journey.sessions}
        totalActiveTimeMs={journey.totalActiveTimeMs}
      />
    </>
  );
}
