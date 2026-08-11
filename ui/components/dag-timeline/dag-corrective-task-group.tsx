"use client";

import { useCallback } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { NodeStatusBadge } from './node-status-badge';
import { DocumentLink } from '@/components/documents';
import { RetryBadge } from '@/components/badges';
import { deriveIterationBadgeLabel, buildCorrectiveItemValue, resolveStageBadge, resolveTaskCardClasses } from './dag-timeline-helpers';
import { CommitChips } from './commit-chips';
import { deriveRetryBudget } from '@/lib/max-retries-resolver';
import type { AnyProjectState, CorrectiveTaskEntry } from '@/types/state';
import type { CorrectiveScope } from '@/components/dag-widget/types';

/** `{ handoff, report }` control labels for each corrective scope. `handoff: null` at `'final'` — there is no handoff at that scope. */
const CORRECTIVE_LABELS: Record<CorrectiveScope, { handoff: string | null; report: string }> = {
  task: { handoff: 'Task Handoff', report: 'Code Review' },
  phase: { handoff: 'Phase Plan', report: 'Phase Report' },
  final: { handoff: null, report: 'Final Review' },
};

interface DAGCorrectiveTaskGroupProps {
  correctiveTasks: CorrectiveTaskEntry[];
  /** The iteration key (iter-...) the corrective is nested under. Used as the `parentIterationKey` argument to buildCorrectiveItemValue (AD-3). */
  parentIterationKey: string;
  parentNodeId: string;
  currentNodePath: string | null;
  onDocClick: (path: string) => void;
  compareUrlByRepo: Record<string, string | null>;
  focusedRowKey: string | null;
  onFocusChange: (nodeId: string) => void;
  expandedLoopIds: string[];
  onAccordionChange: (value: string[], eventDetails: { reason: string }) => void;
  /** The scope this group's correctives belong to — the loop kind (or step host) that hosts them. */
  correctiveScope: CorrectiveScope;
  /** Resolved phase_review doc for a phase corrective, or final_review doc for a final corrective; null for task correctives. */
  phaseReviewDocPath: string | null;
  /** Project state — threaded to `deriveRetryBudget` so the retry ceiling always comes from the shared resolver, never a local `config.limits` read. */
  state: AnyProjectState;
  /** The host's `corrective_budget_origin` (0 for iteration hosts). Defaults to 0. */
  budgetOrigin?: number;
}

export const GROUP_ARIA_LABEL = "Corrective tasks";
export const CORRECTIVE_CHILD_DEPTH = 2;

export function buildCorrectiveChildNodeId(parentNodeId: string, ctIndex: number, childNodeId: string): string {
  return `${parentNodeId}.ct${ctIndex}.${childNodeId}`;
}

export function buildTriggerText(index: number): string {
  return `Corrective Task ${index}`;
}

function CorrectiveRow({
  entry,
  parentIterationKey,
  isFocused,
  onFocusChange,
  parentNodeId,
  currentNodePath,
  onDocClick,
  compareUrlByRepo,
  focusedRowKey,
  expandedLoopIds,
  onAccordionChange,
  correctiveScope,
  phaseReviewDocPath,
  state,
  budgetOrigin,
}: {
  entry: CorrectiveTaskEntry;
  parentIterationKey: string;
  isFocused: boolean;
  onFocusChange: (id: string) => void;
  parentNodeId: string;
  currentNodePath: string | null;
  onDocClick: (path: string) => void;
  compareUrlByRepo: Record<string, string | null>;
  focusedRowKey: string | null;
  expandedLoopIds: string[];
  onAccordionChange: (value: string[], eventDetails: { reason: string }) => void;
  correctiveScope: CorrectiveScope;
  phaseReviewDocPath: string | null;
  state: AnyProjectState;
  budgetOrigin: number;
}) {
  const itemValue = buildCorrectiveItemValue(parentIterationKey, entry.index);
  const handleFocus = useCallback(() => onFocusChange(itemValue), [itemValue, onFocusChange]);

  // The runtime CorrectiveTaskEntry may carry a `corrective_tasks` field for
  // nested correctives (recursive case, FR-9 / FR-10 / DD-8) even though the
  // ui/types declaration today only types it on IterationEntry. Read defensively
  // through this view so the source preserves `entry.corrective_tasks` access at
  // exactly one place and the rest of the function can compose with `??`.
  const nestedCorrectives: CorrectiveTaskEntry[] =
    (entry as unknown as { corrective_tasks?: CorrectiveTaskEntry[] }).corrective_tasks ?? [];

  // FR-10 — derive the corrective's badge through the same helper task
  // iterations use, treating the corrective entry as an IterationEntry-
  // shaped value (it already carries .status / .nodes / .corrective_tasks).
  const derivedBadge = deriveIterationBadgeLabel(
    {
      index: entry.index,
      status: entry.status,
      nodes: entry.nodes,
      corrective_tasks: nestedCorrectives,
      doc_path: entry.doc_path ?? null,
      repos: entry.repos,
    },
    'for_each_task',
  );
  let ctCssVar: string;
  if (derivedBadge.label === 'Correcting' || derivedBadge.label === 'Failed') {
    ctCssVar = '--status-failed';
  } else {
    const ctStageId =
      derivedBadge.label === 'Reviewing'  ? 'code_review'  :
      derivedBadge.label === 'Coding'     ? 'task_executor': '';
    ctCssVar = resolveStageBadge(ctStageId, derivedBadge.status).cssVar;
  }

  const hasHandoff = entry.doc_path != null && entry.doc_path !== '';
  const codeReviewNode = entry.nodes['code_review'];
  const codeReviewDocPath = (codeReviewNode && 'doc_path' in codeReviewNode) ? codeReviewNode.doc_path : null;
  const reportDocPath = (correctiveScope === 'phase' || correctiveScope === 'final') ? phaseReviewDocPath : codeReviewDocPath;
  const hasReport = reportDocPath != null && reportDocPath !== '';
  const { handoff: handoffLabel, report: reportLabel } = CORRECTIVE_LABELS[correctiveScope];
  // Window-relative retry budget for this entry, sourced from the shared
  // resolver — null for a spent-window entry (predates budgetOrigin).
  const retryBudget = deriveRetryBudget(entry, state, budgetOrigin);
  // FR-15: commit rendering is now solely CommitChips; hasAnyTrailing includes repos presence.
  const hasAnyTrailing = hasHandoff || hasReport || retryBudget !== null || (entry.repos != null && entry.repos.length > 0);
  // FR-9 / FR-10 / DD-8 — chevron is gated on entry.corrective_tasks.length > 0.
  const hasNested = nestedCorrectives.length > 0;
  const isCorrected = entry.status === 'completed' &&
    nestedCorrectives.some((ct) => ct.status === 'completed');

  const headerInner = (
    <>
      <NodeStatusBadge
        status={derivedBadge.status}
        label={derivedBadge.label}
        cssVar={ctCssVar}
        iconOnly={entry.status === 'completed'}
      />
      <span className="text-sm font-medium truncate min-w-0">{buildTriggerText(entry.index)}</span>
      {(hasAnyTrailing || isCorrected) && (
        <span aria-hidden="true" className="invisible ml-auto inline-flex items-center gap-2 pl-3 text-sm shrink-0">
          {hasHandoff && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3.5 w-3.5" />
              <span>{handoffLabel}</span>
            </span>
          )}
          {hasReport && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3.5 w-3.5" />
              <span>{reportLabel}</span>
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
      {retryBudget !== null && (
        <RetryBadge attempt={retryBudget.attempt} max={retryBudget.max} />
      )}
      <CommitChips repos={entry.repos} compareUrlByRepo={compareUrlByRepo} singleRepo={Object.keys(compareUrlByRepo).length <= 1} />
      {hasHandoff && (
        <DocumentLink path={entry.doc_path!} label={handoffLabel!} onDocClick={onDocClick} />
      )}
      {hasReport && (
        <DocumentLink path={reportDocPath!} label={reportLabel} onDocClick={onDocClick} />
      )}
    </div>
  );

  if (hasNested) {
    return (
      <AccordionItem value={buildCorrectiveItemValue(parentIterationKey, entry.index)} className={resolveTaskCardClasses(entry.status)}>
        <div className="relative flex items-center gap-2 rounded-md hover:bg-accent/50 pr-3">
          <div className="flex-1 [&>h3]:flex-1 [&>h3]:min-w-0">
            <AccordionTrigger
              role="option"
              aria-selected={false}
              aria-label={`${buildTriggerText(entry.index)} — ${derivedBadge.label}`}
              className="hover:no-underline gap-2 items-center py-2 px-3 border-0 w-full"
              data-timeline-row
              data-row-key={itemValue}
              tabIndex={isFocused ? 0 : -1}
              onFocus={handleFocus}
            >
              {headerInner}
            </AccordionTrigger>
          </div>
          {(hasAnyTrailing || isCorrected) && trailingLinks}
        </div>
        <AccordionContent>
          <DAGCorrectiveTaskGroup
            correctiveTasks={nestedCorrectives}
            parentIterationKey={itemValue}
            parentNodeId={`${parentNodeId}.ct${entry.index}`}
            currentNodePath={currentNodePath}
            onDocClick={onDocClick}
            compareUrlByRepo={compareUrlByRepo}
            focusedRowKey={focusedRowKey}
            onFocusChange={onFocusChange}
            expandedLoopIds={expandedLoopIds}
            onAccordionChange={onAccordionChange}
            correctiveScope="task"
            phaseReviewDocPath={null}
            state={state}
          />
        </AccordionContent>
      </AccordionItem>
    );
  }

  // Flat-row branch (FR-9 / FR-10 / DD-8)
  return (
    <div className={resolveTaskCardClasses(entry.status)}>
      <div
        role="option"
        aria-selected={false}
        aria-label={`${buildTriggerText(entry.index)} — ${derivedBadge.label}`}
        className="relative flex items-center gap-2 rounded-md hover:bg-accent/50 pr-3 py-2 px-3"
        data-timeline-row
        data-row-key={itemValue}
        tabIndex={isFocused ? 0 : -1}
        onFocus={handleFocus}
      >
        {headerInner}
        {(hasAnyTrailing || isCorrected) && trailingLinks}
      </div>
    </div>
  );
}

export function DAGCorrectiveTaskGroup({
  correctiveTasks,
  parentIterationKey,
  parentNodeId,
  currentNodePath,
  onDocClick,
  compareUrlByRepo,
  focusedRowKey,
  onFocusChange,
  expandedLoopIds,
  onAccordionChange,
  correctiveScope,
  phaseReviewDocPath,
  state,
  budgetOrigin = 0,
}: DAGCorrectiveTaskGroupProps) {
  if (correctiveTasks.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={GROUP_ARIA_LABEL}
      className="mt-2 border-l-2 border-dashed border-[var(--color-warning)] pl-3 ml-3"
    >
      <span className="text-xs text-muted-foreground font-medium mb-1 block">Corrective Tasks</span>
      <Accordion multiple value={expandedLoopIds} onValueChange={onAccordionChange}>
        {correctiveTasks.map((entry) => (
          <CorrectiveRow
            key={entry.index}
            entry={entry}
            parentIterationKey={parentIterationKey}
            isFocused={focusedRowKey === buildCorrectiveItemValue(parentIterationKey, entry.index)}
            onFocusChange={onFocusChange}
            parentNodeId={parentNodeId}
            currentNodePath={currentNodePath}
            onDocClick={onDocClick}
            compareUrlByRepo={compareUrlByRepo}
            focusedRowKey={focusedRowKey}
            expandedLoopIds={expandedLoopIds}
            onAccordionChange={onAccordionChange}
            correctiveScope={correctiveScope}
            phaseReviewDocPath={phaseReviewDocPath}
            state={state}
            budgetOrigin={budgetOrigin}
          />
        ))}
      </Accordion>
    </div>
  );
}
