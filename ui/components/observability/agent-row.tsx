import * as React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { modelColor } from '@/lib/observability/model-color';
import { humanizeTokens } from '@/lib/observability/format';
import { formatDuration } from '@/lib/observability/duration-format';
import type { AgentTreeNode } from '@/lib/observability/subagent-tree';
import { SpendBar } from './spend-bar';
import { SeamLinks } from './seam-links';

export interface AgentRowProps {
  node: AgentTreeNode;
  scaleMax: number;
  variant: 'main' | 'group' | 'run' | 'leaf';
  expanded?: boolean;
  onToggle?: () => void;
}

// Uniform CSS grid so name·bar·tokens·%·seam align across all depths (DD-3).
const ROW_GRID = 'grid grid-cols-[200px_minmax(0,1fr)_64px_44px_78px]';

export function AgentRow({ node, scaleMax, variant, expanded, onToggle }: AgentRowProps) {
  const pct = scaleMax > 0 ? (node.tokens / scaleMax) * 100 : 0;
  const dominant = node.models[0]?.model ?? 'other';
  const meta = `${node.reqs} req${node.reqs === 1 ? '' : 's'} · ${formatDuration(Math.max(0, node.lastMs - node.firstMs))}`; // hover meta (FR-11)
  const showSeam = variant !== 'group';                                                                                    // groups have none (FR-7)
  return (
    <div className={cn('group items-center min-h-[38px] border-t border-border/50 hover:bg-muted/30 px-2', ROW_GRID)} title={meta}>
      <div className={cn('flex items-center gap-1.5 min-w-0', variant === 'run' && 'pl-6')}>
        {variant === 'group' ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!!expanded}
            aria-label={`${node.label} — ${expanded ? 'collapse' : 'expand'} runs`}
            className="inline-flex size-3.5 items-center justify-center text-muted-foreground focus-visible:ring-ring"
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="inline-block size-3.5" aria-hidden="true" />
        )}
        <span className="size-2 rounded-full shrink-0" style={{ background: `var(${modelColor(dominant)})` }} aria-hidden="true" />
        <span className={cn('truncate text-sm', variant === 'run' && 'font-mono text-muted-foreground')}>{node.label}</span>
        {variant === 'group' && node.runCount > 1 && <Badge variant="outline" className="ml-1">×{node.runCount}</Badge>}
      </div>
      <SpendBar segments={node.models} total={node.tokens} scaleMax={scaleMax} className="mx-2" />
      <span className="text-right tabular-nums font-semibold text-sm">{humanizeTokens(node.tokens)}</span>
      <span className="text-right tabular-nums text-xs text-muted-foreground">{Math.round(pct)}%</span>
      <div className="flex justify-end">{showSeam ? <SeamLinks kind={variant === 'main' ? 'main' : 'subagent'} /> : <span aria-hidden="true" />}</div>
    </div>
  );
}
