import * as React from 'react';
import { cn } from '@/lib/utils';
import { modelColor } from '@/lib/observability/model-color';
import { AGENT_ACTIVE_WINDOW_MS } from '@/lib/observability/activity-dot-color';
import { humanizeTokens } from '@/lib/observability/format';
import { formatDuration } from '@/lib/observability/duration-format';
import { SPEND_LABELS, formatUsd } from '@/lib/observability/spend-display';
import type { AgentTreeNode } from '@/lib/observability/subagent-tree';
import { SpendBar } from './spend-bar';
import { ActivityDot } from './activity-dot';

export interface AgentRowProps {
  node: AgentTreeNode;
  scaleMax: number;
  variant: 'main' | 'subagent';
  now: number;
  /** When provided, the whole row becomes a click target that opens the Agent Inspector (FR-3, AD-7). */
  inspect?: { onInspect: () => void };
}

// Uniform CSS grid so name·bar·Cost·New Tokens·Total Tokens align across all depths (DD-3).
// Shared with agent-tree.tsx's header row so the two templates never drift apart.
export const ROW_GRID_COLS = 'grid-cols-[200px_minmax(0,1fr)_72px_84px_96px]';
const ROW_GRID = `grid ${ROW_GRID_COLS}`;

export function AgentRow({ node, scaleMax, now, inspect }: AgentRowProps) {
  const dominant = node.models[0]?.model ?? 'other';
  const meta = `${node.reqs} req${node.reqs === 1 ? '' : 's'} · ${formatDuration(Math.max(0, node.lastMs - node.firstMs))}`; // hover meta (FR-11)
  const clickable = !!inspect;                                                                                             // any row with a transcript is a whole-row click target
  return (
    <div
      className={cn(
        'group relative items-center min-h-[38px] border-t border-border/50 px-2',
        clickable ? 'cursor-pointer rounded-md hover:bg-accent/50' : 'hover:bg-muted/30',
        ROW_GRID,
      )}
      title={meta}
    >
      {clickable && (
        <button
          type="button"
          aria-label={`Inspect ${node.label}`}
          onClick={() => inspect!.onInspect()}
          className="absolute inset-0 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="inline-block size-3.5" aria-hidden="true" />
        <ActivityDot msSinceActivity={now - node.lastMs} color={`var(${modelColor(dominant)})`} activeWindowMs={AGENT_ACTIVE_WINDOW_MS} className="size-2 shrink-0" />
        <span className="truncate text-sm">{node.label}</span>
      </div>
      <SpendBar segments={node.models} total={node.tokens} scaleMax={scaleMax} className="mx-2" />
      <span className="text-center tabular-nums text-sm" title={SPEND_LABELS.cost}>{formatUsd(node.dollars)}</span>
      <span className="text-center tabular-nums text-xs text-muted-foreground" title={SPEND_LABELS.newTokens}>{humanizeTokens(node.newTokens)}</span>
      <span className="text-center tabular-nums font-semibold text-sm" title={SPEND_LABELS.costWeighted}>{humanizeTokens(node.tokens)}</span>
    </div>
  );
}
