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
 * Tracks whether the viewport is at Tailwind's `lg` breakpoint (≥ 1024px) or
 * wider — the width at which the Planning grid switches from a single stacked
 * column to its two-up row. Starts `false` for a stable SSR / first-paint value
 * (the stacked layout), then syncs on mount and on viewport change. Mirrors
 * `usePrefersReducedMotion` in `dag-state-card.tsx`; `1024px` is Tailwind's
 * default `lg`, the same breakpoint the grid's own `lg:grid-cols-2` resolves
 * against.
 */
function useIsTwoUpViewport(): boolean {
  const [twoUp, setTwoUp] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setTwoUp(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return twoUp;
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

  // Only the combined two-up row pairs the docs column and the card as
  // siblings in one grid row — a solo docs column or solo card (the two
  // degraded single-column cases below) keeps its own natural content height.
  const isRow = hasDocs && showCard;

  // The card-height mirroring below is a real layout constraint, so it must
  // only apply where the two columns actually share a grid row — at `lg`+.
  // `isTwoUp` tracks that same breakpoint; below `lg` the grid stacks into
  // independent rows and the docs column must keep its natural, uncapped
  // height (capping it there would clip/force-scroll the docs list in a
  // layout that is supposed to size to its own content).
  const isTwoUp = useIsTwoUpViewport();

  // Plain grid `stretch` sizes the row's `auto` track to whichever child is
  // naturally taller. That's correct when the card is taller (the common
  // case), but when the docs list is naturally taller, the row would grow to
  // fit it instead of the card — leaving the card with dead space and the
  // docs column with nothing to scroll. Mirroring the card's own rendered
  // height onto the docs column's `max-height` caps the docs column's
  // contribution to that row-sizing calculation to at most the card's
  // height, so the row always resolves to the card's height regardless of
  // which child is naturally taller; the docs column's existing internal
  // `overflow-y-auto` then engages whenever its content exceeds that cap. The
  // cap is only applied at `lg`+ (gated on `isTwoUp`) — never in the stacked
  // layout, where the two columns no longer share a row.
  const cardWrapperRef = React.useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!isRow) return;
    const el = cardWrapperRef.current;
    if (!el) return;
    const measure = () => setCardHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isRow]);

  if (!hasDocs && !showCard) return null;

  // The card-height cap (`maxHeight`) is `isTwoUp`-gated above so it never
  // constrains the stacked (below-`lg`) layout, where the docs column and the
  // card no longer share a row track — each sits alone in its own auto row,
  // sized to its own content. There `flex-1`/`overflow-y-auto` have no shorter
  // container to overflow and `tabIndex` is a harmless no-op stop rather than
  // a real scroll region. The tab stop itself stays gated on `isRow` alone
  // (not `isTwoUp`): it is a cosmetic focus target, not a layout constraint,
  // so its off-breakpoint presence is a harmless no-op and not worth an extra
  // viewport-conditional render.
  const docsColumn = (
    <Card className={cn("py-2")} style={isRow && isTwoUp && cardHeight != null ? { maxHeight: cardHeight } : undefined}>
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

  const cardElement = (
    <DagStateCard
      state={state}
      onDocClick={onDocClick}
      compareUrlByRepo={compareUrlByRepo}
      projectName={projectName}
    />
  );

  // Only the two-up row needs the measuring wrapper. Default grid `stretch`
  // would otherwise size this wrapper to the row's own (pre-cap) height, so
  // `ResizeObserver` would measure the stretched box instead of the card's
  // true natural height on the very first, uncapped render — `self-start`
  // keeps the wrapper pinned to its own content size regardless of the row's
  // current height, so every measurement reflects the card alone.
  const card = isRow ? (
    <div ref={cardWrapperRef} className="self-start">
      {cardElement}
    </div>
  ) : (
    cardElement
  );

  return (
    <div role="group" aria-label="Planning section">
      <div aria-hidden="true" className={SECTION_LABEL_CLASSES}>Planning</div>
      {isRow ? (
        // Default `align-items: stretch` (no override) makes the docs column
        // fill the row's auto height — resolved to the card's height via the
        // `max-height` mirroring above — down to that height, so its own
        // `overflow-y-auto` scrolls past it. The card can never overflow a
        // row sized to its own natural height, so it needs no scroll-fallback
        // machinery of its own.
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
