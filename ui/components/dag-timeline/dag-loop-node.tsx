"use client";

import { Fragment } from 'react';
import { DAGIterationPanel } from './dag-iteration-panel';
import type { AnyProjectState, ForEachPhaseNodeState, ForEachTaskNodeState } from '@/types/state';

export interface DAGLoopNodeProps {
  nodeId: string;
  node: ForEachPhaseNodeState | ForEachTaskNodeState;
  currentNodePath: string | null;
  onDocClick: (path: string) => void;
  expandedLoopIds: string[];
  onAccordionChange: (
    value: string[],
    eventDetails: { reason: string }
  ) => void;
  compareUrlByRepo: Record<string, string | null>;
  projectName: string;
  focusedRowKey: string | null;
  isFocused: boolean;
  onFocusChange: (nodeId: string) => void;
  /** Project state — threaded to each DAGIterationPanel so its corrective groups can resolve retry badges through the shared resolver. */
  state: AnyProjectState;
}

/**
 * Transparent iteration mapper (AD-1). Renders one DAGIterationPanel per
 * iteration with no surrounding shell — no Accordion, no header row, no
 * loop-${nodeId} accordion value. The iteration panels themselves own the
 * accordion behaviour (AD-2). Iterations are sorted by index ascending
 * (DD-8: oldest first, newest at the bottom). Keys off node.kind via the
 * caller's own dispatch in dag-timeline.tsx / dag-iteration-panel.tsx
 * (FR-18 — generalises to any for_each_* template loop).
 *
 * The `isFocused` and `onFocusChange` props are kept on the prop signature
 * so call sites in dag-timeline.tsx do not need to change shape, but they
 * are intentionally unused here — focus is owned by the iteration accordion
 * triggers, not by a loop-row that no longer exists.
 */
export function DAGLoopNode({
  nodeId,
  node,
  currentNodePath,
  onDocClick,
  expandedLoopIds,
  onAccordionChange,
  compareUrlByRepo,
  projectName,
  focusedRowKey,
  onFocusChange,
  state,
}: DAGLoopNodeProps) {
  const sortedIterations = [...node.iterations].sort((a, b) => a.index - b.index);
  return (
    <Fragment>
      {sortedIterations.map((iteration) => (
        <DAGIterationPanel
          key={iteration.index}
          iteration={iteration}
          iterationIndex={iteration.index}
          parentNodeId={nodeId}
          parentKind={node.kind}
          currentNodePath={currentNodePath}
          onDocClick={onDocClick}
          compareUrlByRepo={compareUrlByRepo}
          projectName={projectName}
          expandedLoopIds={expandedLoopIds}
          onAccordionChange={onAccordionChange}
          focusedRowKey={focusedRowKey}
          onFocusChange={onFocusChange}
          state={state}
        />
      ))}
    </Fragment>
  );
}
