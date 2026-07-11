'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { humanizeTokens } from '@/lib/observability/format';
import { Skeleton } from '@/components/ui/skeleton';
import type { SubagentTree, AgentTreeNode } from '@/lib/observability/subagent-tree';
import { freezeSubagentOrder } from '@/lib/observability/subagent-tree';
import { rowTranscriptId } from '@/lib/observability/transcript-identity';
import { AgentRow, ROW_GRID_COLS } from './agent-row';
import { ModelLegend } from './model-legend';

export interface AgentTreeProps {
  tree: SubagentTree;       // pre-built by buildSubagentTree — the reuse seam, NOT raw rows (AD-1)
  title?: string;
  coverage?: number;
  ready?: boolean;
  now: number;
  /** Session id — used to resolve the main row's transcript id (FR-3, AD-7). */
  sessionId?: string;
  /** Called with the transcript id when the user clicks the Inspect button (FR-3, AD-7). */
  onInspect?: (transcriptId: string) => void;
}

const CARD = 'rounded-xl bg-card ring-1 ring-foreground/10';   // matches summary-card.tsx exactly (DD-1)

function Header({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <ModelLegend />
    </div>
  );
}

function leafFrom(group: AgentTreeNode): AgentTreeNode {
  const run = group.runs?.[0];
  return run ? { ...run, label: group.label, key: group.key } : group;   // single-run group → leaf row keeps group label
}

// Light column header — reuses AgentRow's exact grid template so columns align to the rows below it.
function RowGridHeader() {
  return (
    <div
      className={cn(
        'grid items-center px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground',
        ROW_GRID_COLS
      )}
    >
      <span>Agent</span>
      <span className="mx-2">Model spend</span>
      <span className="whitespace-nowrap">Cost</span>
      <span className="whitespace-nowrap">New Tokens</span>
      <span className="whitespace-nowrap">Total Tokens</span>
    </div>
  );
}

// Pure & reusable: owns ONLY expand state; no data fetch, no page/live imports (AD-1).
export function AgentTree({ tree, title = 'Agent Breakdown', coverage, ready = true, now, sessionId, onInspect }: AgentTreeProps) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const toggle = React.useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);   // keyed by node.key → survives ticks (FR-9)
      return next;
    });
  }, []);

  // Freeze row order within a turn; re-snapshot the order when the stream settles (ready rising edge) (NFR-7).
  const frozenOrder = React.useRef<string[]>([]);
  const wasReady = React.useRef(false);
  React.useEffect(() => {
    if (ready && !wasReady.current) frozenOrder.current = tree.subagents.map((n) => n.key);
    wasReady.current = ready;
  }, [ready, tree.subagents]);
  const orderedSubagents = freezeSubagentOrder(tree.subagents, frozenOrder.current);

  /** Build an inspect prop for a given transcript id (or null if not inspectable). */
  function inspectProp(transcriptId: string | null) {
    if (!onInspect || !transcriptId) return undefined;
    return { onInspect: () => onInspect(transcriptId) };
  }

  if (!ready) {
    return (
      <section className={CARD} aria-busy="true">
        <Header title={title} />
        <div className="px-3 pb-3 pt-2 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[38px] w-full" />)}
        </div>
      </section>
    );
  }

  if (tree.windowTotal === 0) {
    return (
      <section className={CARD}>
        <Header title={title} />
        <p className="px-5 py-6 text-sm text-muted-foreground">No agent activity in the selected window.</p>
      </section>
    );
  }

  const coverageNote = coverage !== undefined && coverage < 0.99 ? ` · covers ~${Math.round(coverage * 100)}% of this session` : '';

  // Main row transcript id: sessionId (FR-3)
  const mainTranscriptId = sessionId ? rowTranscriptId(tree.main, 'main', sessionId) : null;

  return (
    <section className={CARD}>
      <Header title={title} />
      <p className="px-5 pt-2 text-xs text-muted-foreground">
        Bars show share of spend in the selected window · in execution order{coverageNote}
      </p>
      <div className="px-3 pb-3 pt-2">
        <RowGridHeader />
        <AgentRow
          node={tree.main}
          scaleMax={tree.windowTotal}
          variant="main"
          now={now}
          inspect={inspectProp(mainTranscriptId)}
        />
        <div className="flex items-center gap-2 px-2 pt-3 pb-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Subagents · {humanizeTokens(tree.subagentTotal)} · {Math.round(tree.subagentPct * 100)}%
          </span>
          <span className="flex-1 border-t border-border" />
        </div>
        {orderedSubagents.map((group) => {
          const isGroup = group.runCount > 1;
          const isOpen = expanded.has(group.key);

          // Resolve transcript ids:
          // - multi-run group → not inspectable (group rows never have inspect buttons, FR-7)
          // - single-run leaf → resolve from the pre-leafFrom group so we get runs[0].key (AD-6)
          // - expanded run rows → resolve from the run node itself
          const leafTranscriptId = !isGroup && sessionId
            ? rowTranscriptId(group, 'leaf', sessionId)   // pass pre-leafFrom group to get runs[0].key
            : null;

          return (
            <React.Fragment key={group.key}>
              <AgentRow
                node={isGroup ? group : leafFrom(group)}
                scaleMax={tree.windowTotal}
                variant={isGroup ? 'group' : 'leaf'}
                now={now}
                expanded={isOpen}
                onToggle={isGroup ? () => toggle(group.key) : undefined}
                inspect={!isGroup ? inspectProp(leafTranscriptId) : undefined}
              />
              {isGroup && isOpen && (group.runs ?? []).map((run) => {
                const runTranscriptId = sessionId ? rowTranscriptId(run, 'run', sessionId) : null;
                return (
                  <AgentRow
                    key={run.key}
                    node={run}
                    scaleMax={tree.windowTotal}
                    variant="run"
                    now={now}
                    inspect={inspectProp(runTranscriptId)}
                  />
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}
