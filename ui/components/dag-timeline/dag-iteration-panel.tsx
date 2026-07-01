"use client";

import { useCallback } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { DAGNodeRow } from './dag-node-row';
import { DAGCorrectiveTaskGroup } from './dag-corrective-task-group';
import { DAGLoopNode } from './dag-loop-node';
import { DocumentLink } from '@/components/documents';
import { ProgressBar } from '@/components/execution/progress-bar';
import { NodeStatusBadge } from './node-status-badge';
import { isLoopNode, parsePhaseNameFromDocPath, parseTaskNameFromDocPath, buildIterationItemValue, deriveIterationTaskProgress, deriveIterationBadgeLabel, shouldRenderTimelineRow, resolveStageBadge } from './dag-timeline-helpers';
import type { CompatibleNodeState } from './dag-timeline-helpers';
import { CommitChips } from './commit-chips';
import type { IterationEntry } from '@/types/state';

interface DAGIterationPanelProps {
  iteration: IterationEntry;
  iterationIndex: number;
  parentNodeId: string;
  parentKind: 'for_each_phase' | 'for_each_task';
  currentNodePath: string | null;
  onDocClick: (path: string) => void;
  compareUrlByRepo: Record<string, string | null>;
  projectName: string;
  expandedLoopIds: string[];
  onAccordionChange: (
    value: string[],
    eventDetails: { reason: string }
  ) => void;
  focusedRowKey: string | null;
  onFocusChange: (nodeId: string) => void;
}

export const ITERATION_CHILD_DEPTH = 1;

export function buildIterationLabel(iterationIndex: number): string {
  return `Iteration ${iterationIndex + 1}`;
}

export function buildIterationChildNodeId(parentNodeId: string, iterationIndex: number, childNodeId: string): string {
  return `${parentNodeId}.iter${iterationIndex}.${childNodeId}`;
}

export function buildCorrectiveGroupParentId(parentNodeId: string, iterationIndex: number): string {
  return `${parentNodeId}.iter${iterationIndex}`;
}

export function DAGIterationPanel({
  iteration,
  iterationIndex,
  parentNodeId,
  parentKind,
  currentNodePath,
  onDocClick,
  compareUrlByRepo,
  projectName,
  expandedLoopIds,
  onAccordionChange,
  focusedRowKey,
  onFocusChange,
}: DAGIterationPanelProps) {
  const correctiveGroupParentId = buildCorrectiveGroupParentId(parentNodeId, iterationIndex);

  // Derive iteration name from iteration.doc_path (post-unify) with a
  // fallback to the legacy per-iteration synthetic nodes
  // (`phase_planning` / `task_handoff`) so existing completed projects
  // browsed via the UI keep their labels.
  let iterationName: string;
  let isFallback: boolean;
  let docPath: string | null;

  if (parentKind === 'for_each_phase') {
    const phaseNode = iteration.nodes['phase_planning'];
    const legacyDocPath = (phaseNode && 'doc_path' in phaseNode) ? phaseNode.doc_path : null;
    docPath = iteration.doc_path ?? legacyDocPath ?? null;
    isFallback = !docPath;
    iterationName = parsePhaseNameFromDocPath(docPath, iterationIndex);
  } else {
    const taskNode = iteration.nodes['task_handoff'];
    const legacyDocPath = (taskNode && 'doc_path' in taskNode) ? taskNode.doc_path : null;
    docPath = iteration.doc_path ?? legacyDocPath ?? null;
    isFallback = !docPath;
    iterationName = parseTaskNameFromDocPath(docPath, iterationIndex);
  }

  // Shared roving-tabindex wiring (FR-16, AD-5)
  const itemValue = buildIterationItemValue(parentNodeId, iterationIndex);
  const isFocused = focusedRowKey === itemValue;
  const handleFocus = useCallback(() => {
    onFocusChange(itemValue);
  }, [itemValue, onFocusChange]);

  // Compute card container classes
  let cardClasses: string;

  if (parentKind === 'for_each_phase') {
    switch (iteration.status) {
      case 'in_progress':
        cardClasses = 'border border-[var(--color-link)] bg-card rounded-md mb-2';
        break;
      case 'completed':
        cardClasses = 'border border-border bg-muted/50 rounded-md mb-2';
        break;
      case 'failed':
      case 'halted':
        cardClasses = 'border border-[var(--status-failed)] bg-card rounded-md mb-2';
        break;
      default:
        cardClasses = 'border border-border bg-card rounded-md mb-2';
    }
  } else {
    switch (iteration.status) {
      case 'in_progress':
        cardClasses = 'border border-border/70 bg-card rounded-md mb-1.5';
        break;
      case 'completed':
        cardClasses = 'border border-border/50 bg-muted/30 rounded-md mb-1.5';
        break;
      case 'failed':
      case 'halted':
        cardClasses = 'border border-[var(--status-failed)] bg-card rounded-md mb-1.5';
        break;
      default:
        cardClasses = 'border border-border/40 bg-card rounded-md mb-1.5';
    }
  }

  if (parentKind === 'for_each_phase') {
    const progress = deriveIterationTaskProgress(iteration);
    const derivedBadge = deriveIterationBadgeLabel(iteration, 'for_each_phase');
    // FR-3 / DD-7 / FR-11 — the phase iteration's tier cssVar mirrors its label:
    // "Executing" (incl. while task_loop is running per FR-3) → --tier-execution,
    // "Reviewing" → --tier-review. The 'Planning' label is no longer returned
    // by the for_each_phase arm (FR-11), so that mapping is removed. For
    // non-in_progress statuses, resolveStageBadge falls through to
    // STATUS_MAP[status].cssVar (DD-2), which is what the iteration's
    // current grey/green/red treatment already expects. "Executing" and
    // "Reviewing" are the only active phase-stage labels for in_progress;
    // other statuses keep their STATUS_MAP labels (Completed / Skipped /
    // Not Started / Failed / Halted), so the label-to-stage-id table only
    // needs to cover the two active labels.
    const phaseStageId =
      derivedBadge.label === 'Reviewing'  ? 'phase_review'  :
      derivedBadge.label === 'Executing'  ? 'task_executor' : '';
    const phaseStageBadge = resolveStageBadge(phaseStageId, derivedBadge.status);
    const headerAriaLabel = `Phase iteration ${iterationIndex + 1} — ${iterationName} — ${derivedBadge.label}`;
    const hasPhasePlan = iteration.doc_path != null && iteration.doc_path !== '';

    // Split iteration.nodes into pre-loop / loop / post-loop buckets so non-loop
    // step nodes (e.g. phase_review) render at phase-level depth OUTSIDE the
    // task spine — aligning them with the phase header and bounding the spine
    // line to task-like content.
    const renderableEntries = Object.entries(iteration.nodes).filter(([childNodeId, childNode]) =>
      shouldRenderTimelineRow(childNodeId, childNode as CompatibleNodeState, { commitHash: null, prUrl: null })
    );
    const loopIndex = renderableEntries.findIndex(([, n]) => isLoopNode(n));
    const preLoopEntries  = loopIndex === -1 ? renderableEntries : renderableEntries.slice(0, loopIndex);
    const loopEntry       = loopIndex === -1 ? null              : renderableEntries[loopIndex];
    const postLoopEntries = loopIndex === -1 ? []                : renderableEntries.slice(loopIndex + 1);
    const showSpine = loopEntry !== null;

    return (
      <Accordion multiple value={expandedLoopIds} onValueChange={onAccordionChange}>
        <AccordionItem value={buildIterationItemValue(parentNodeId, iterationIndex)} className={cardClasses}>
          <div className="relative flex items-center gap-2 rounded-md hover:bg-accent/50 pr-3">
            <div className="flex-1 flex items-center gap-2 min-w-0 [&>h3]:flex-1 [&>h3]:min-w-0">
              <AccordionTrigger
                role="option"
                aria-selected={false}
                aria-label={headerAriaLabel}
                className="hover:no-underline gap-2 items-center py-2 px-3 border-0 w-full"
                data-timeline-row
                data-row-key={itemValue}
                tabIndex={isFocused ? 0 : -1}
                onFocus={handleFocus}
              >
                <NodeStatusBadge
                  status={derivedBadge.status}
                  label={derivedBadge.label}
                  cssVar={phaseStageBadge.cssVar}
                  iconOnly={iteration.status === 'completed'}
                />
                <span className={isFallback ? 'text-sm italic text-muted-foreground truncate min-w-0' : 'text-sm font-medium truncate min-w-0'}>
                  {iterationName}
                </span>
                {progress !== null && (
                  <div className="flex-1 min-w-24">
                    <ProgressBar
                      completed={progress.completed}
                      total={progress.total}
                      showCount={progress.total > 0}
                    />
                  </div>
                )}
                {/* Invisible placeholder reserves layout space for the absolute-positioned Phase Plan link below; chevron auto-renders next via shadcn's ml-auto on data-slot=accordion-trigger-icon. The pl-3 widens the reserved area so the visible Phase Plan link doesn't crowd the ProgressBar's "N/N tasks" label. */}
                {hasPhasePlan && (
                  <span aria-hidden="true" className="invisible inline-flex items-center gap-1.5 pl-3 text-sm shrink-0">
                    <span className="inline-block h-3.5 w-3.5" />
                    <span>Phase Plan</span>
                  </span>
                )}
              </AccordionTrigger>
            </div>
            {hasPhasePlan && (
              <div className="absolute right-12 top-1/2 -translate-y-1/2 z-10">
                <DocumentLink path={iteration.doc_path!} label="Phase Plan" onDocClick={onDocClick} />
              </div>
            )}
          </div>
          <AccordionContent>
            {/* Body shape: phase-level non-loop step nodes (e.g. phase_review) and the
                phase-iteration corrective task group render OUTSIDE the spine container so
                they align with the phase header. The border-l spine wraps only the task
                loop, so its grey line bounds task content only; the corrective group's own
                dashed warning border picks up at the same x-column where the spine stops,
                signalling that phase-level CTs are owned by the phase, not the tasks. */}
            {preLoopEntries.map(([childNodeId, childNode]) => {
              const childKey = buildIterationChildNodeId(parentNodeId, iterationIndex, childNodeId);
              return isLoopNode(childNode) ? (
                <DAGLoopNode
                  key={childNodeId}
                  nodeId={childKey}
                  node={childNode}
                  currentNodePath={currentNodePath}
                  onDocClick={onDocClick}
                  expandedLoopIds={expandedLoopIds}
                  onAccordionChange={onAccordionChange}
                  compareUrlByRepo={compareUrlByRepo}
                  projectName={projectName}
                  focusedRowKey={focusedRowKey}
                  isFocused={focusedRowKey === childKey}
                  onFocusChange={onFocusChange}
                />
              ) : (
                <DAGNodeRow
                  key={childNodeId}
                  nodeId={childKey}
                  node={childNode}
                  depth={0}
                  currentNodePath={currentNodePath}
                  onDocClick={onDocClick}
                  isFocused={focusedRowKey === childKey}
                  onFocusChange={onFocusChange}
                />
              );
            })}
            {showSpine && (
              <div className="border-l border-border pl-3 ml-3">
                {loopEntry !== null && (() => {
                  const [childNodeId, childNode] = loopEntry;
                  const childKey = buildIterationChildNodeId(parentNodeId, iterationIndex, childNodeId);
                  return isLoopNode(childNode) ? (
                    <DAGLoopNode
                      key={childNodeId}
                      nodeId={childKey}
                      node={childNode}
                      currentNodePath={currentNodePath}
                      onDocClick={onDocClick}
                      expandedLoopIds={expandedLoopIds}
                      onAccordionChange={onAccordionChange}
                      compareUrlByRepo={compareUrlByRepo}
                      projectName={projectName}
                      focusedRowKey={focusedRowKey}
                      isFocused={focusedRowKey === childKey}
                      onFocusChange={onFocusChange}
                    />
                  ) : (
                    <DAGNodeRow
                      key={childNodeId}
                      nodeId={childKey}
                      node={childNode}
                      depth={ITERATION_CHILD_DEPTH}
                      currentNodePath={currentNodePath}
                      onDocClick={onDocClick}
                      isFocused={focusedRowKey === childKey}
                      onFocusChange={onFocusChange}
                    />
                  );
                })()}
              </div>
            )}
            <DAGCorrectiveTaskGroup
              correctiveTasks={iteration.corrective_tasks}
              parentIterationKey={itemValue}
              parentNodeId={correctiveGroupParentId}
              currentNodePath={currentNodePath}
              onDocClick={onDocClick}
              compareUrlByRepo={compareUrlByRepo}
              focusedRowKey={focusedRowKey}
              onFocusChange={onFocusChange}
              expandedLoopIds={expandedLoopIds}
              onAccordionChange={onAccordionChange}
            />
            {postLoopEntries.map(([childNodeId, childNode]) => {
              const childKey = buildIterationChildNodeId(parentNodeId, iterationIndex, childNodeId);
              return isLoopNode(childNode) ? (
                <DAGLoopNode
                  key={childNodeId}
                  nodeId={childKey}
                  node={childNode}
                  currentNodePath={currentNodePath}
                  onDocClick={onDocClick}
                  expandedLoopIds={expandedLoopIds}
                  onAccordionChange={onAccordionChange}
                  compareUrlByRepo={compareUrlByRepo}
                  projectName={projectName}
                  focusedRowKey={focusedRowKey}
                  isFocused={focusedRowKey === childKey}
                  onFocusChange={onFocusChange}
                />
              ) : (
                <DAGNodeRow
                  key={childNodeId}
                  nodeId={childKey}
                  node={childNode}
                  depth={0}
                  currentNodePath={currentNodePath}
                  onDocClick={onDocClick}
                  isFocused={focusedRowKey === childKey}
                  onFocusChange={onFocusChange}
                />
              );
            })}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  }

  // for_each_task branch (FR-1, FR-5, FR-7, FR-8, FR-9, FR-13)
  const derivedBadge = deriveIterationBadgeLabel(iteration, 'for_each_task');
  // Task iteration cssVar mirrors its label vocabulary:
  //   Coding     → --tier-execution (FR-2 / DD-1)
  //   Reviewing  → --tier-review
  //   Correcting → --status-failed (FR-4 / DD-3 / NFR-2)
  //   Failed     → --status-failed (FR-6 / DD-4 / NFR-2)
  //   non-in_progress / non-failed → STATUS_MAP defaults via resolveStageBadge
  let taskCssVar: string;
  if (derivedBadge.label === 'Correcting') {
    taskCssVar = '--status-failed';
  } else if (derivedBadge.label === 'Failed') {
    taskCssVar = '--status-failed';
  } else {
    const taskStageId =
      derivedBadge.label === 'Reviewing'  ? 'code_review'  :
      derivedBadge.label === 'Coding'     ? 'task_executor': '';
    taskCssVar = resolveStageBadge(taskStageId, derivedBadge.status).cssVar;
  }
  const headerAriaLabel = `Task iteration ${iterationIndex + 1} — ${iterationName} — ${derivedBadge.label}`;
  const hasTaskHandoff = iteration.doc_path != null && iteration.doc_path !== '';
  const codeReviewNode = iteration.nodes['code_review'];
  const codeReviewDocPath = (codeReviewNode && 'doc_path' in codeReviewNode) ? codeReviewNode.doc_path : null;
  const hasCodeReview = codeReviewDocPath != null && codeReviewDocPath !== '';
  // FR-15: commit rendering is now solely CommitChips; hasAnyTaskTrailing is true
  // whenever there are repos to render chips for.
  const hasAnyTaskTrailing = hasTaskHandoff || hasCodeReview || (iteration.repos != null && iteration.repos.length > 0);
  const hasCorrectives = iteration.corrective_tasks.length > 0;
  const isCorrected = iteration.status === 'completed' &&
    iteration.corrective_tasks.some((ct) => ct.status === 'completed');

  // Shared header content — used by both the AccordionTrigger (chevron) and
  // the flat-div (no-chevron) shapes so the visual chrome stays identical.
  const headerInner = (
    <>
      <NodeStatusBadge
        status={derivedBadge.status}
        label={derivedBadge.label}
        cssVar={taskCssVar}
        iconOnly={iteration.status === 'completed'}
      />
      <span className={isFallback ? 'text-sm italic text-muted-foreground truncate min-w-0' : 'text-sm font-medium truncate min-w-0'}>
        {iterationName}
      </span>
      {(hasAnyTaskTrailing || isCorrected) && (
        <span aria-hidden="true" className="invisible ml-auto inline-flex items-center gap-2 pl-3 text-sm shrink-0">
          {hasTaskHandoff && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3.5 w-3.5" />
              <span>Task Handoff</span>
            </span>
          )}
          {hasCodeReview && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3.5 w-3.5" />
              <span>Code Review</span>
            </span>
          )}
        </span>
      )}
    </>
  );

  const trailingLinks = (
    <div className="absolute right-12 top-1/2 -translate-y-1/2 z-10 flex items-center gap-2">
      {isCorrected && (
        <span
          aria-label="Corrected"
          className="inline-flex items-center text-xs font-normal px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
            color: 'var(--color-warning)',
          }}
        >
          Corrected
        </span>
      )}
      <CommitChips repos={iteration.repos} compareUrlByRepo={compareUrlByRepo} singleRepo={Object.keys(compareUrlByRepo).length <= 1} />
      {hasTaskHandoff && (
        <DocumentLink path={iteration.doc_path!} label="Task Handoff" onDocClick={onDocClick} />
      )}
      {hasCodeReview && (
        <DocumentLink path={codeReviewDocPath!} label="Code Review" onDocClick={onDocClick} />
      )}
    </div>
  );

  // FR-9 / AD-4 / DD-8 — chevron-gated shape. With correctives, render the
  // accordion shape (chevron + expandable content). Without, render a flat
  // <div> row preserving data-timeline-row + data-row-key for follow mode.
  if (hasCorrectives) {
    return (
      <Accordion multiple value={expandedLoopIds} onValueChange={onAccordionChange}>
        <AccordionItem value={itemValue} className={cardClasses}>
          <div className="relative flex items-center gap-2 rounded-md hover:bg-accent/50 pr-3">
            <div className="flex-1 flex items-center gap-2 min-w-0 [&>h3]:flex-1 [&>h3]:min-w-0">
              <AccordionTrigger
                role="option"
                aria-selected={false}
                aria-label={headerAriaLabel}
                className="hover:no-underline gap-2 items-center py-2 px-3 border-0 w-full"
                data-timeline-row
                data-row-key={itemValue}
                tabIndex={isFocused ? 0 : -1}
                onFocus={handleFocus}
              >
                {headerInner}
              </AccordionTrigger>
            </div>
            {(hasAnyTaskTrailing || isCorrected) && trailingLinks}
          </div>
          <AccordionContent>
            <DAGCorrectiveTaskGroup
              correctiveTasks={iteration.corrective_tasks}
              parentIterationKey={itemValue}
              parentNodeId={correctiveGroupParentId}
              currentNodePath={currentNodePath}
              onDocClick={onDocClick}
              compareUrlByRepo={compareUrlByRepo}
              focusedRowKey={focusedRowKey}
              onFocusChange={onFocusChange}
              expandedLoopIds={expandedLoopIds}
              onAccordionChange={onAccordionChange}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  }

  // Flat-row branch (FR-9 / DD-8) — no chevron, no AccordionItem, no
  // AccordionContent. data-timeline-row + data-row-key preserved on the
  // outermost focusable element.
  return (
    <div className={cardClasses}>
      <div
        role="option"
        aria-selected={false}
        aria-label={headerAriaLabel}
        className="relative flex items-center gap-2 rounded-md hover:bg-accent/50 pr-3 py-2 px-3"
        data-timeline-row
        data-row-key={itemValue}
        tabIndex={isFocused ? 0 : -1}
        onFocus={handleFocus}
      >
        {headerInner}
        {(hasAnyTaskTrailing || isCorrected) && trailingLinks}
      </div>
    </div>
  );
}
