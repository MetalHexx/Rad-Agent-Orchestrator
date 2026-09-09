'use client';

import { Layers, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkGraphContainerData } from '@/types/work-graph';

interface WorkGraphContainerNodeProps {
  data: WorkGraphContainerData;
}

export function WorkGraphContainerNode({ data }: WorkGraphContainerNodeProps) {
  // Groups carry no tier and no meaningful status, so every real container shares one
  // accent; only the synthetic Ungrouped container is coloured differently, marking it
  // as a presentation device rather than a group in the data.
  const accent = data.synthetic ? 'var(--tier-not-initialized)' : 'var(--tier-planning)';
  const Icon = data.synthetic ? Folder : Layers;

  return (
    <div
      className="w-full h-full rounded-[var(--radius-lg)]"
      style={{
        background: 'var(--canvas-node-group-bg)',
        borderTop: `3px solid ${accent}`,
        borderRight: '1px dashed var(--canvas-node-group-border)',
        borderBottom: '1px dashed var(--canvas-node-group-border)',
        borderLeft: '1px dashed var(--canvas-node-group-border)',
      }}
      role="group"
      aria-label={data.label}
    >
      <div className={cn('flex items-center h-[40px] px-3 gap-2 rounded-t-[var(--radius-lg)] bg-[var(--card)]')}>
        <Icon className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" aria-hidden="true" />

        <span className="text-sm font-medium text-[var(--card-foreground)] truncate">
          {data.label}
        </span>

        <span className="ml-auto text-[11px] text-[var(--muted-foreground)] shrink-0">
          {data.count} {data.count === 1 ? 'project' : 'projects'}
        </span>
      </div>
    </div>
  );
}
