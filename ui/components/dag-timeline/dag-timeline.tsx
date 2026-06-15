"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NodesRecord, NodeState, NodeStatus } from '@/types/state';
import { DAGNodeRow } from './dag-node-row';
import { DAGLoopNode } from './dag-loop-node';
import { isLoopNode, groupNodesBySection, NODE_SECTION_MAP, shouldRenderTimelineRow, buildIterationItemValue } from './dag-timeline-helpers';
import type { CompatibleNodeState } from './dag-timeline-helpers';
import { DAGSectionGroup } from './dag-section-group';

interface DAGTimelineProps {
  nodes: NodesRecord;
  currentNodePath: string | null;
  onDocClick: (path: string) => void;
  expandedLoopIds: string[];
  onAccordionChange: (
    value: string[],
    eventDetails: { reason: string }
  ) => void;
  compareUrlByRepo: Record<string, string | null>;
  projectName: string;
  /** Top-level phase_loop.status for FR-2 Execute Plan visibility (AD-2). */
  phaseLoopStatus?: NodeStatus;
  /** PR URL from state.pipeline.source_control.pr_url; surfaced on the
   *  `final_pr` row only (Completion section). */
  prUrl?: string | null;
  /** Optional render slot injected immediately after the Planning section group
   *  and before the Execution section group. Used to position the Source
   *  Control panel in the correct on-screen order (FR-2). */
  afterPlanningSlot?: React.ReactNode;
}

/**
 * Parse the iteration-encoded `lostKey` and return the chain of ancestor
 * loop nodeIds, ordered deepest-first (longest prefix first). The encoding
 * follows `buildIterationChildNodeId` (`${parentNodeId}.iter${N}.${childNodeId}`)
 * and `buildCorrectiveChildNodeId` (which builds on a parent already shaped as
 * `${loopId}.iter${N}`), so each `.iter\d+\.` boundary in the key marks an
 * ancestor loop nodeId ending. A lostKey with no `.iter\d+\.` boundary
 * (e.g. a top-level row key) returns an empty array — there is no loop to
 * fall back to.
 */
export function deriveAncestorLoopKeys(lostKey: string): string[] {
  const result: string[] = [];
  const regex = /\.iter\d+\./g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lostKey)) !== null) {
    result.push(lostKey.slice(0, match.index));
  }
  return result.reverse();
}

/**
 * Translates one (loopParentId, iterationIndex) pair into the iteration
 * accordion's `data-row-key` (iter-...). Used by the focus-fallback
 * useEffect to map each `loopParentId` returned by `deriveAncestorLoopKeys`
 * into the accordion key the iteration panel actually stamps onto its
 * trigger (AD-3 — single shared key shape). Delegates to the canonical
 * `buildIterationItemValue` builder so the encoding stays in one place.
 */
export function iterationAncestorToAccordionKey(loopParentId: string, iterationIndex: number): string {
  return buildIterationItemValue(loopParentId, iterationIndex);
}

/**
 * Returns the deepest-first list of accordion `data-row-key` values to try
 * when focus has been lost to body after the row that owned `focusedRowKey`
 * was unmounted (typically because an ancestor accordion collapsed).
 *
 * `focusedRowKey` arrives in three shapes:
 *   - compound nodeId: `phase_loop.iter0.task_handoff` — walk every
 *     `.iterN.` boundary into an iteration trigger key.
 *   - iteration trigger key: `iter-${parentNodeId}-${iterIndex}` — walk
 *     `parentNodeId`'s own `.iterN.` boundaries (the trigger itself is
 *     gone, so we want its enclosing iteration if any).
 *   - corrective trigger key: `ct-${parentIterationKey}-${ctIndex}` —
 *     fall back directly to `parentIterationKey`, then recurse upward.
 */
export function deriveAccordionFallbackKeys(focusedRowKey: string): string[] {
  if (focusedRowKey.startsWith('ct-')) {
    const lastDash = focusedRowKey.lastIndexOf('-');
    if (lastDash <= 2) return [];
    const parentIterationKey = focusedRowKey.slice(3, lastDash);
    return [parentIterationKey, ...deriveAccordionFallbackKeys(parentIterationKey)];
  }
  if (focusedRowKey.startsWith('iter-')) {
    const lastDash = focusedRowKey.lastIndexOf('-');
    if (lastDash <= 4) return [];
    const parentNodeId = focusedRowKey.slice(5, lastDash);
    return derivePrefixAccordionKeys(parentNodeId + '.');
  }
  return derivePrefixAccordionKeys(focusedRowKey);
}

function derivePrefixAccordionKeys(compoundKey: string): string[] {
  const result: string[] = [];
  const regex = /\.iter(\d+)\./g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(compoundKey)) !== null) {
    const loopParentId = compoundKey.slice(0, match.index);
    const iterIndex = Number.parseInt(match[1], 10);
    result.push(buildIterationItemValue(loopParentId, iterIndex));
  }
  return result.reverse();
}

export function DAGTimeline({ nodes, currentNodePath, onDocClick, expandedLoopIds, onAccordionChange, compareUrlByRepo, projectName, phaseLoopStatus, prUrl, afterPlanningSlot }: DAGTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const groups = groupNodesBySection(nodes);
  const unmatchedEntries = Object.entries(nodes).filter(([nodeId]) => !Object.hasOwn(NODE_SECTION_MAP, nodeId));

  const focusableRowKeys = useMemo(() => {
    const keys: string[] = [];
    for (const group of groups) {
      for (const [nodeId] of group.entries) {
        keys.push(nodeId);
      }
    }
    for (const [nodeId] of unmatchedEntries) {
      keys.push(nodeId);
    }
    return keys;
  }, [groups, unmatchedEntries]);

  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(() => focusableRowKeys[0] ?? null);

  useEffect(() => {
    // Derive the keyset from the DOM so nested iteration/corrective rows
    // (keys like `phase_loop.iter0.task_handoff`) are honored — focusableRowKeys
    // only holds top-level nodeIds and would otherwise treat any nested focus
    // as stale and clobber it.
    const container = containerRef.current;
    if (container === null) return;
    const renderedKeys = Array.from(
      container.querySelectorAll<HTMLElement>('[data-timeline-row][data-row-key]')
    )
      .map((el) => el.dataset.rowKey)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);
    if (renderedKeys.length === 0) {
      // SSE-late row arrival: DOM hasn't painted rows yet but the top-level
      // keyset is known. Reseed from focusableRowKeys when the focused key is
      // null or stale so the listbox stays Tab-enterable on first render.
      if (
        focusableRowKeys.length > 0 &&
        (focusedRowKey === null || !focusableRowKeys.includes(focusedRowKey))
      ) {
        setFocusedRowKey(focusableRowKeys[0]);
      }
      return;
    }
    if (focusedRowKey === null || !renderedKeys.includes(focusedRowKey)) {
      setFocusedRowKey(renderedKeys[0]);
    }
  }, [focusableRowKeys, focusedRowKey, expandedLoopIds]);

  const handleFocusChange = useCallback((nodeId: string) => {
    setFocusedRowKey(nodeId);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    // Stop propagation so the event never reaches base-ui's AccordionTrigger
    // onKeyDown (which calls stopEvent + focuses "next trigger" in the same
    // single-item Accordion, trapping focus on the loop row). Combined with
    // onKeyDownCapture below, this runs before any child bubble-phase handler.
    event.stopPropagation();
    const container = containerRef.current;
    if (container === null) return;
    const items = Array.from(
      container.querySelectorAll<HTMLElement>('[data-timeline-row]')
    );
    if (items.length === 0) return;
    // Resolve the active row via the nearest [data-timeline-row] ancestor so
    // arrow-nav stays anchored to the row even when focus is on a descendant
    // button (DocumentLink / ApproveGateButton are tabIndex={-1} but still
    // clickable and can hold focus).
    const activeElement =
      event.target instanceof Element
        ? event.target
        : document.activeElement instanceof Element
          ? document.activeElement
          : null;
    const activeRow = activeElement?.closest<HTMLElement>('[data-timeline-row]') ?? null;
    const currentIndex = items.findIndex((item) => item === activeRow);
    let nextIndex: number;
    if (event.key === 'ArrowDown') {
      nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    }
    items[nextIndex].focus();
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.activeElement !== document.body) return;
    if (focusedRowKey === null) return;
    const container = containerRef.current;
    if (container === null) return;

    // Walk deepest-first up the chain of accordion ancestors that could
    // still be in the DOM after a collapse. `deriveAccordionFallbackKeys`
    // handles all three shapes the focused row key can take: compound
    // nodeIds (e.g. `phase_loop.iter0.task_loop.iter2.task_handoff`),
    // iteration trigger keys (`iter-*`), and corrective trigger keys
    // (`ct-*`).
    for (const accordionKey of deriveAccordionFallbackKeys(focusedRowKey)) {
      const target = container.querySelector<HTMLElement>(
        `[data-row-key="${CSS.escape(accordionKey)}"]`
      );
      if (target !== null) {
        target.focus();
        return;
      }
    }
  }, [expandedLoopIds, focusedRowKey]);

  const renderNodeEntry = ([nodeId, node]: [string, NodeState]): ReactNode => (
    <div key={nodeId} role="presentation">
      {isLoopNode(node) ? (
        <DAGLoopNode
          nodeId={nodeId}
          node={node}
          currentNodePath={currentNodePath}
          onDocClick={onDocClick}
          expandedLoopIds={expandedLoopIds}
          onAccordionChange={onAccordionChange}
          compareUrlByRepo={compareUrlByRepo}
          projectName={projectName}
          focusedRowKey={focusedRowKey}
          isFocused={focusedRowKey === nodeId}
          onFocusChange={handleFocusChange}
        />
      ) : (
        <DAGNodeRow
          nodeId={nodeId}
          node={node}
          currentNodePath={currentNodePath}
          onDocClick={onDocClick}
          projectName={projectName}
          isFocused={focusedRowKey === nodeId}
          onFocusChange={handleFocusChange}
          phaseLoopStatus={phaseLoopStatus}
          prUrl={prUrl}
        />
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Pipeline timeline"
      onKeyDownCapture={handleKeyDown}
      className="flex flex-col gap-3"
    >
      {groups.map((group) => (
        <Fragment key={group.label}>
          <DAGSectionGroup label={group.label}>
            {group.entries
              .filter(([nodeId, node]) => shouldRenderTimelineRow(nodeId, node as CompatibleNodeState, { commitHash: null, prUrl: prUrl ?? null }))
              .map(renderNodeEntry)}
          </DAGSectionGroup>
          {group.label === 'Planning' && afterPlanningSlot}
        </Fragment>
      ))}
      {unmatchedEntries
        .filter(([nodeId, node]) => shouldRenderTimelineRow(nodeId, node as CompatibleNodeState, { commitHash: null, prUrl: prUrl ?? null }))
        .map(renderNodeEntry)}
    </div>
  );
}
