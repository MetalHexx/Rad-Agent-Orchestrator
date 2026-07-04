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

  // Only the combined two-up row pairs the docs column and the card as
  // siblings in one grid row — a solo docs column or solo card (the two
  // degraded single-column cases below) keeps its own natural content height.
  const isRow = hasDocs && showCard;

  // `isRow` gates the docs list's scroll/tabIndex machinery on the two-up
  // composition being active, not on the `lg` breakpoint itself. Below `lg`
  // the grid collapses to one column, so the docs column and the card no
  // longer share a row track — each sits alone in its own auto row, sized to
  // its own content, so `flex-1`/`overflow-y-auto` have no shorter container
  // to overflow and `tabIndex` is a harmless no-op stop rather than a real
  // scroll region. Making it viewport-exact would need a client-side
  // matchMedia check (see `usePrefersReducedMotion` in `dag-state-card.tsx`)
  // purely to gate one attribute — not worth the added SSR/hydration mismatch
  // risk for a cosmetic tab stop.
  const docsColumn = (
    <Card className={cn("py-2")}>
      <div className={cn("py-2", isRow && "min-h-0 flex-1 overflow-y-auto")} tabIndex={isRow ? 0 : undefined}>
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
      {isRow ? (
        // Default `align-items: stretch` (no override) makes both grid cells
        // share the row's auto height — resolved from the taller child, in
        // practice the card — rather than a hand-picked pixel constant. The
        // card can never overflow a row sized to its own natural height, so
        // it needs no scroll-fallback machinery of its own; only the docs
        // column can end up shorter than its content and scrolls internally.
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
