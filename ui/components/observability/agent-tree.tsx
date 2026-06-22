'use client';
import * as React from 'react';
import { humanizeTokens } from '@/lib/observability/format';
import { Skeleton } from '@/components/ui/skeleton';
import type { SubagentTree, AgentTreeNode } from '@/lib/observability/subagent-tree';
import { freezeSubagentOrder } from '@/lib/observability/subagent-tree';
import { AgentRow } from './agent-row';
import { ModelLegend } from './model-legend';

export interface AgentTreeProps {
  tree: SubagentTree;       // pre-built by buildSubagentTree — the reuse seam, NOT raw rows (AD-1)
  title?: string;
  coverage?: number;
  ready?: boolean;
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

// Pure & reusable: owns ONLY expand state; no data fetch, no page/live imports (AD-1).
export function AgentTree({ tree, title = 'Subagent Breakdown', coverage, ready = true }: AgentTreeProps) {
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

  return (
    <section className={CARD}>
      <Header title={title} />
      <p className="px-5 pt-2 text-xs text-muted-foreground">
        Bars and % show share of spend in the selected window · sorted by spend{coverageNote}
      </p>
      <div className="px-3 pb-3 pt-2">
        <AgentRow node={tree.main} scaleMax={tree.windowTotal} variant="main" />
        <div className="flex items-center gap-2 px-2 pt-3 pb-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Subagents · {humanizeTokens(tree.subagentTotal)} · {Math.round(tree.subagentPct * 100)}%
          </span>
          <span className="flex-1 border-t border-border" />
        </div>
        {orderedSubagents.map((group) => {
          const isGroup = group.runCount > 1;
          const isOpen = expanded.has(group.key);
          return (
            <React.Fragment key={group.key}>
              <AgentRow
                node={isGroup ? group : leafFrom(group)}
                scaleMax={tree.windowTotal}
                variant={isGroup ? 'group' : 'leaf'}
                expanded={isOpen}
                onToggle={isGroup ? () => toggle(group.key) : undefined}
              />
              {isGroup && isOpen && (group.runs ?? []).map((run) => (
                <AgentRow key={run.key} node={run} scaleMax={tree.windowTotal} variant="run" />
              ))}
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}
