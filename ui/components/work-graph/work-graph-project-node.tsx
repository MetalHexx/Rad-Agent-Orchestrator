'use client';

import { Handle, Position } from '@xyflow/react';
import { FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { PipelineTierBadge } from '@/components/badges';
import { ProjectKindBadge } from '@/components/badges/project-kind-badge';
import { KIND_PRESENTATION } from '@/components/badges/project-kind-presentation';
import { cn } from '@/lib/utils';
import type { WorkGraphProjectData } from '@/types/work-graph';

/** Every tier `WorkGraphProjectData['tier']` can carry, plus the synthetic
 *  `not_initialized` fallback — kept exhaustive so a new tier can't silently
 *  fall through to a transparent accent. */
const ACCENT_BY_TIER: Record<string, string> = {
  planning: 'var(--tier-planning)',
  execution: 'var(--tier-execution)',
  review: 'var(--tier-review)',
  halted: 'var(--tier-halted)',
  complete: 'var(--tier-complete)',
  not_initialized: 'var(--tier-not-initialized)',
};

interface WorkGraphProjectNodeProps {
  data: WorkGraphProjectData;
}

export function WorkGraphProjectNode({ data }: WorkGraphProjectNodeProps) {
  const router = useRouter();
  // Accepted cosmetic consequence: the accent stays keyed off the coarser `tier`
  // while the badge below is keyed off the canonical `state`, so a project
  // reading "Not Started" or "Planned" shows the planning-tier accent colour.
  const accent = ACCENT_BY_TIER[data.tier] ?? 'transparent';

  const navigate = () => {
    router.push(`/projects/${encodeURIComponent(data.id)}`);
  };

  return (
    <div
      className={cn(
        'relative flex items-center w-[320px] h-[56px]',
        'bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius-md)]',
        'px-3 py-2 gap-2',
        'hover:bg-accent/50 cursor-pointer',
      )}
      // The canvas disables React Flow's own selection/drag machinery
      // (`elementsSelectable`/`nodesDraggable` false), which makes React Flow
      // set `pointer-events: none` on the `.react-flow__node` wrapper around
      // every node — an explicit `auto` here is what lets a real pointer click
      // still reach this node's own onClick.
      style={{ boxShadow: `inset 3px 0 0 ${accent}`, pointerEvents: 'auto' }}
      // A real <a> can't be used here (React Flow renders node content inside its
      // own non-anchor wrapper), so role="link" is what tells assistive tech this
      // activates navigation — role="group" gave no hint that Enter/click does
      // anything at all.
      role="link"
      aria-label={data.label}
      tabIndex={0}
      onClick={navigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate();
        }
      }}
    >
      {/* The layout module picks which pair of handles each edge binds to;
          all four must exist on every project node with these exact ids. */}
      <Handle type="target" position={Position.Top} id="t-top" isConnectable={false} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Top} id="s-top" isConnectable={false} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" isConnectable={false} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" isConnectable={false} style={{ opacity: 0 }} />

      <FileText className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" aria-hidden="true" />

      <span className="text-sm font-medium text-[var(--card-foreground)] truncate flex-1 min-w-0">
        {data.label}
      </span>

      <span className="shrink-0">
        {KIND_PRESENTATION[data.projectType ?? 'standard'].replacesStateBadge
          ? <ProjectKindBadge projectType={data.projectType} />
          : <PipelineTierBadge state={data.state} label={data.stateLabel} />}
      </span>
    </div>
  );
}
