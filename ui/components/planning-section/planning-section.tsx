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
 * `overflow-y-auto` kicks in. 180px (the top of the phase's ~160-180px
 * budget) gives the card's own natural content — ring + heading/meta block
 * plus a realistic controls row (doc buttons, a multi-repo commit-chip
 * group) — the most headroom available under that budget; the card wrapper's
 * own `overflow-y-auto` (see `card` below) is the backstop for content that
 * still runs longer than that. Unset below `lg`, where the columns stack and
 * relax to natural content height instead of clipping.
 */
const PLANNING_ROW_HEIGHT_CLASS = "lg:h-[180px]";

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

  // `isRow` gates the scroll/tabIndex machinery below on the two-up
  // composition being active, not on the `lg` breakpoint itself — below `lg`
  // the fixed height class never applies, so `overflow-y-auto`/`flex-1` are
  // inert and `tabIndex` is a harmless no-op stop rather than a real scroll
  // region. Making it viewport-exact would need a client-side matchMedia
  // check (see `usePrefersReducedMotion` in `dag-state-card.tsx`) purely to
  // gate one attribute — not worth the added SSR/hydration mismatch risk for
  // a cosmetic tab stop.
  const docsColumn = (
    <Card className={cn("py-2", isRow && PLANNING_ROW_HEIGHT_CLASS)}>
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

  const dagStateCard = (
    <DagStateCard
      state={state}
      onDocClick={onDocClick}
      compareUrlByRepo={compareUrlByRepo}
      projectName={projectName}
    />
  );
  // `overflow-y-auto` rather than `overflow-hidden`: the 180px budget fits the
  // card's realistic content, but real state-view controls (a wrapped commit-
  // chip row, a longer corrective reason) can still occasionally run past it —
  // scrolling keeps that content reachable instead of silently discarding it.
  // Two details make that scroll genuinely work, not just present as a class:
  //  - `*:shrink-0` — without it the card, a flex item whose own root already
  //    carries `overflow-hidden` (`ui/components/ui/card.tsx`), gets its
  //    automatic min-height floored to zero and the flexbox algorithm shrinks
  //    it down to fit the 180px box instead of overflowing, so the excess
  //    content is silently clipped inside the card itself and this wrapper's
  //    `overflow-y-auto` never even sees an overflow to scroll.
  //  - `[justify-content:safe_center]` instead of `justify-center` — plain
  //    (`unsafe`) centering of an overflowing flex item makes only half the
  //    overflow reachable by scroll (the other half is centered off the start
  //    edge with nothing to scroll to); `safe` falls back to start-alignment
  //    once the item no longer fits, keeping the whole card scrollable.
  const card = isRow ? (
    <div
      className={cn("flex flex-col overflow-y-auto *:shrink-0 [justify-content:safe_center]", PLANNING_ROW_HEIGHT_CLASS)}
    >
      {dagStateCard}
    </div>
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
