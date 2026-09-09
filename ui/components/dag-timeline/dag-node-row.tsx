"use client";

import { useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { NodeStatusBadge } from './node-status-badge';
import { DocumentLink, ExternalLink } from '@/components/documents';
import { ExecutePlanButton } from '@/components/dashboard';
import { getDisplayName, getRowButtonDescriptor, deriveGateBadgeStatusAndLabel, getDocLinkLabel, resolveStageBadge } from './dag-timeline-helpers';
import type { CompatibleNodeState } from './dag-timeline-helpers';
import type { PrLink } from './source-control-helpers';
import type { NodeStatus } from '@/types/state';

interface DAGNodeRowProps {
  nodeId: string;
  node: CompatibleNodeState;
  currentNodePath: string | null;
  onDocClick: (path: string) => void;
  depth?: number;
  projectName?: string;
  isFocused: boolean;
  onFocusChange: (nodeId: string) => void;
  /** Top-level phase_loop status; drives FR-2 Execute Plan visibility (AD-2). */
  phaseLoopStatus?: NodeStatus;
  /** Pull requests surfaced on the `final_pr` row (Completion section), one
   *  per repo carrying a live PR. Sourced from
   *  `state.pipeline.source_control.repos` via `selectPrLinks` and threaded
   *  through DAGTimeline; ignored on every other row. */
  prLinks?: PrLink[];
}

// Re-export formatNodeId to preserve barrel export contract
export { formatNodeId } from './dag-timeline-helpers';

export function DAGNodeRow({ nodeId, node, currentNodePath, onDocClick, depth = 0, projectName, isFocused, onFocusChange, phaseLoopStatus, prLinks = [] }: DAGNodeRowProps) {
  const isActive = nodeId === currentNodePath;
  const descriptor =
    node.kind === 'gate' && projectName !== undefined
      ? getRowButtonDescriptor(nodeId, node, phaseLoopStatus)
      : { kind: 'none' as const };
  // The DAG-state card (dag-widget) now renders its own Approve action for
  // the active plan/final-approval gate, so a row-level 'approve' descriptor
  // is intentionally not rendered below — it would be a redundant second
  // Approve button. `hasActionButton` is gated the same way so keyboard
  // activation doesn't think a button is present when nothing renders.
  const hasActionButton = descriptor.kind === 'execute';
  const isFinalPrRow = nodeId === 'final_pr' && prLinks.length > 0;

  // Resolve stage-aware {status, cssVar, label, isSpinning} for the row.
  // Gate rows flow through deriveGateBadgeStatusAndLabel, which overrides
  // label/cssVar/isSpinning to the resting Pending Review badge while the
  // gate blocks on a person, leaving status untouched. Non-gate rows resolve
  // via resolveStageBadge, which folds the legacy planning-step path into
  // the same lookup so planning steps read --tier-planning + "Planning".
  const stageBadge = resolveStageBadge(nodeId, node.status);
  const resolvedBadge = node.kind === 'gate'
    ? (() => {
        const gate = deriveGateBadgeStatusAndLabel(node);
        const gateStage = resolveStageBadge(nodeId, gate.status);
        return {
          status: gate.status,
          label: gate.label,
          cssVar: gate.cssVar ?? gateStage.cssVar,
          isSpinning: gate.isSpinning,           // undefined on the non-blocking path
        };
      })()
    : { status: node.status, label: stageBadge.label, cssVar: stageBadge.cssVar, isSpinning: undefined };

  const actionButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleFocus = useCallback(() => {
    onFocusChange(nodeId);
  }, [nodeId, onFocusChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // A focused PR anchor (reachable via Tab when there are 2+ repos, see the
    // tabIndex below) handles its own Enter/Space activation natively —
    // stepping aside here keeps the row-level synthesis below scoped to
    // "the row itself has focus", so it never overrides which link the user
    // actually selected. Checked by tagName rather than `instanceof
    // HTMLAnchorElement` so this doesn't depend on a DOM global being present.
    const target = event.target as { tagName?: string } | null;
    if (target?.tagName === 'A') return;
    event.preventDefault();
    if (hasActionButton && actionButtonRef.current !== null) {
      actionButtonRef.current.click();
    } else if (isFinalPrRow) {
      window.open(prLinks[0].url, '_blank', 'noopener,noreferrer');
    } else if (node.kind === 'step' && node.doc_path != null && node.doc_path !== '') {
      onDocClick(node.doc_path);
    }
  }, [hasActionButton, isFinalPrRow, prLinks, node, onDocClick]);

  return (
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
      style={{ paddingLeft: 12 + depth * 16 }}
    >
      <NodeStatusBadge
        status={resolvedBadge.status}
        label={resolvedBadge.label}
        cssVar={resolvedBadge.cssVar}
        isSpinning={resolvedBadge.isSpinning}
        iconOnly={resolvedBadge.status === 'completed'}
      />
      <span className="text-sm font-medium min-w-0 shrink truncate max-w-[55%]">{getDisplayName(nodeId)}</span>
      {node.kind === 'step' && node.doc_path != null && node.doc_path !== '' && (
        <DocumentLink path={node.doc_path} label={getDocLinkLabel(nodeId)} onDocClick={onDocClick} tabIndex={-1} />
      )}
      {isFinalPrRow && prLinks.map((link) => (
        <ExternalLink
          key={link.repoName}
          href={link.url}
          label={prLinks.length > 1 ? `${link.repoName} Pull Request` : 'Pull Request'}
          icon="github"
          // With a single PR, the row's own Enter/Space handler opens it, so
          // the anchor stays out of the roving-tabindex row's tab stop.
          // With 2+ repos there is no single "primary" link to synthesize a
          // click on, so each anchor joins the natural Tab order instead —
          // otherwise only the first repo's PR would ever be keyboard
          // reachable.
          tabIndex={prLinks.length > 1 ? undefined : -1}
        />
      ))}
      {descriptor.kind === 'execute' && (
        <ExecutePlanButton
          ref={actionButtonRef}
          projectName={projectName!}
          className="ml-auto"
          tabIndex={-1}
        />
      )}
    </div>
  );
}
