"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { SECTION_LABEL_CLASSES } from "@/components/dag-timeline/dag-section-group";
import { DagStateCard } from "@/components/dag-widget";
import { PlanningDocsList } from "./planning-docs-list";
import type { Artifact } from "@/lib/artifact-model";
import type { ProjectStateV5, ProjectStateV6 } from "@/types/state";

/**
 * Whether the right-hand DAG-state card has anything to render for `state`.
 * A completed run always shows (the card resolves its Complete end-cap off
 * `graph.status`); otherwise the card needs a current node to focus. A parsed
 * project still sitting at `not_started` carries a null `current_node_path`, so
 * there is no node — the section degrades to the docs column alone rather than
 * painting an empty card frame.
 */
export function shouldShowStateCard(state: ProjectStateV5 | ProjectStateV6): boolean {
  if (state.graph.status === "completed") return true;
  const path = state.graph.current_node_path;
  return path != null && path.length > 0;
}

export interface PlanningSectionProps {
  /** Ordered Planning root docs (Requirements + Master Plan pinned first). */
  artifacts: Artifact[];
  requirementsStatus: string | null;
  onOpen: (index: number) => void;
  onDelete: (artifact: Artifact) => void;
  unseen?: Set<string>;
  activePulse?: Set<string>;
  /** Live pipeline state feeding the right-hand card. Non-null: the section
   *  only mounts inside the page's active (parsed-state) branch. */
  state: ProjectStateV5 | ProjectStateV6;
  onDocClick: (path: string) => void;
  compareUrlByRepo: Record<string, string | null>;
  projectName: string;
}

/**
 * The unified Planning section: the ordered docs list beside the live
 * DAG-state card in a responsive two-up row. Equal `1fr` tracks on `lg`+,
 * stacking to a single column (docs above card) below it. When the card has no
 * node to resolve it drops out and the docs list takes the full width; when
 * there are no docs the card stands alone — the section renders nothing only
 * when both are empty.
 */
export function PlanningSection({
  artifacts,
  requirementsStatus,
  onOpen,
  onDelete,
  unseen,
  activePulse,
  state,
  onDocClick,
  compareUrlByRepo,
  projectName,
}: PlanningSectionProps) {
  const showCard = shouldShowStateCard(state);
  const hasDocs = artifacts.length > 0;
  if (!hasDocs && !showCard) return null;

  const docsColumn = (
    <Card className="py-2">
      <PlanningDocsList
        artifacts={artifacts}
        requirementsStatus={requirementsStatus}
        onOpen={onOpen}
        onDelete={onDelete}
        unseen={unseen}
        activePulse={activePulse}
      />
    </Card>
  );

  const card = (
    <DagStateCard
      state={state}
      onDocClick={onDocClick}
      compareUrlByRepo={compareUrlByRepo}
      projectName={projectName}
    />
  );

  return (
    <div role="group" aria-label="Planning section">
      <div aria-hidden="true" className={SECTION_LABEL_CLASSES}>Planning</div>
      {hasDocs && showCard ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {docsColumn}
          {card}
        </div>
      ) : hasDocs ? (
        docsColumn
      ) : (
        card
      )}
    </div>
  );
}
