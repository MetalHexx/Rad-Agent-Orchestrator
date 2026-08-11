"use client";

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { NodeStatusBadge } from './node-status-badge';
import { DocumentLink } from '@/components/documents';
import { DAGCorrectiveTaskGroup } from './dag-corrective-task-group';
import { getDisplayName, getDocLinkLabel, deriveCorrectiveHostBadge } from './dag-timeline-helpers';
import type { AnyProjectState, StepNodeState } from '@/types/state';

interface DAGFinalReviewPanelProps {
  nodeId: string;
  node: StepNodeState;
  currentNodePath: string | null;
  onDocClick: (path: string) => void;
  compareUrlByRepo: Record<string, string | null>;
  isFocused: boolean;
  onFocusChange: (nodeId: string) => void;
  focusedRowKey: string | null;
  expandedLoopIds: string[];
  onAccordionChange: (value: string[], eventDetails: { reason: string }) => void;
  state: AnyProjectState;
}

/**
 * Renders the `final_review` row inside the Completion section, mirroring
 * DAGNodeRow's row chrome, and — whenever the step hosts correctives —
 * `DAGCorrectiveTaskGroup` beneath it, always expanded (no chevron). The
 * group's `parentIterationKey`/`parentNodeId` are the node id itself
 * (`final_review`), since there is no enclosing iteration at this scope, so
 * corrective row keys read `ct-final_review-1`. The retry budget's window
 * origin is read off the step's own `corrective_budget_origin` (a step
 * host, unlike an iteration host, can accumulate a non-zero origin as
 * review windows close).
 */
export function DAGFinalReviewPanel({
  nodeId,
  node,
  currentNodePath,
  onDocClick,
  compareUrlByRepo,
  isFocused,
  onFocusChange,
  focusedRowKey,
  expandedLoopIds,
  onAccordionChange,
  state,
}: DAGFinalReviewPanelProps) {
  const isActive = nodeId === currentNodePath;
  const correctiveTasks = node.corrective_tasks ?? [];
  const resolvedBadge = deriveCorrectiveHostBadge(nodeId, node.status, correctiveTasks);

  const handleFocus = useCallback(() => {
    onFocusChange(nodeId);
  }, [nodeId, onFocusChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (node.doc_path != null && node.doc_path !== '') {
      onDocClick(node.doc_path);
    }
  }, [node.doc_path, onDocClick]);

  return (
    <>
      <div
        role="option"
        aria-selected={isActive}
        tabIndex={isFocused ? 0 : -1}
        data-timeline-row
        aria-label={`${getDisplayName(nodeId)} — ${resolvedBadge.label}`}
        aria-current={isActive ? 'step' : undefined}
        data-row-key={nodeId}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        className={cn(
          'py-2 pr-3 rounded-md gap-2 flex items-center hover:bg-accent/50',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
          isActive && 'border-l-2 border-l-[var(--color-link)]'
        )}
        style={{ paddingLeft: 12 }}
      >
        <NodeStatusBadge
          status={resolvedBadge.status}
          label={resolvedBadge.label}
          cssVar={resolvedBadge.cssVar}
          iconOnly={resolvedBadge.status === 'completed'}
        />
        <span className="text-sm font-medium min-w-0 shrink truncate max-w-[55%]">{getDisplayName(nodeId)}</span>
        {node.doc_path != null && node.doc_path !== '' && (
          <DocumentLink path={node.doc_path} label={getDocLinkLabel(nodeId)} onDocClick={onDocClick} tabIndex={-1} />
        )}
      </div>
      {correctiveTasks.length > 0 && (
        <DAGCorrectiveTaskGroup
          correctiveTasks={correctiveTasks}
          parentIterationKey={nodeId}
          parentNodeId={nodeId}
          currentNodePath={currentNodePath}
          onDocClick={onDocClick}
          compareUrlByRepo={compareUrlByRepo}
          focusedRowKey={focusedRowKey}
          onFocusChange={onFocusChange}
          expandedLoopIds={expandedLoopIds}
          onAccordionChange={onAccordionChange}
          correctiveScope="final"
          phaseReviewDocPath={node.doc_path}
          state={state}
          budgetOrigin={node.corrective_budget_origin ?? 0}
        />
      )}
    </>
  );
}
