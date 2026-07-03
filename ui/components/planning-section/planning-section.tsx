"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SECTION_LABEL_CLASSES } from "@/components/dag-timeline/dag-section-group";
import { DagStateCard } from "@/components/dag-widget";
import { PlanningDocsList } from "./planning-docs-list";
import type { Artifact } from "@/lib/artifact-model";
import type { ProjectStateV5, ProjectStateV6 } from "@/types/state";

/**
 * Shared fixed height for the docs column and the card in the two-up row on
 * `lg`+ — tall enough to show ~3 doc rows before the docs column's own
 * `overflow-y-auto` kicks in. Unset below `lg`, where the columns stack and
 * relax to natural content height instead of clipping.
 */
const PLANNING_ROW_HEIGHT_CLASS = "lg:h-[168px]";

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

  // Only the combined two-up row gets the shared fixed height and the docs
  // column's internal scroll — a solo docs column or solo card (the two
  // degraded single-column cases below) keeps its natural content height.
  const isRow = hasDocs && showCard;

  const docsColumn = (
    <Card className={cn("py-2", isRow && PLANNING_ROW_HEIGHT_CLASS)}>
      <div className={cn("py-2", isRow && "min-h-0 flex-1 overflow-y-auto")}>
        <PlanningDocsList
          artifacts={artifacts}
          requirementsStatus={requirementsStatus}
          onOpen={onOpen}
          onDelete={onDelete}
          unseen={unseen}
          activePulse={activePulse}
        />
      </div>
    </Card>
  );

  const dagStateCard = (
    <DagStateCard
      state={state}
      onDocClick={onDocClick}
      compareUrlByRepo={compareUrlByRepo}
      projectName={projectName}
    />
  );
  const card = isRow ? (
    <div className={cn("flex flex-col justify-center", PLANNING_ROW_HEIGHT_CLASS)}>{dagStateCard}</div>
  ) : (
    dagStateCard
  );

  return (
    <div role="group" aria-label="Planning section">
      <div aria-hidden="true" className={SECTION_LABEL_CLASSES}>Planning</div>
      {isRow ? (
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
