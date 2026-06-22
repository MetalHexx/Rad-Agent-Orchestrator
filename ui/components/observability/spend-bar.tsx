import * as React from 'react';
import { cn } from '@/lib/utils';
import { modelColor } from '@/lib/observability/model-color';
import type { SpendSegment } from '@/lib/observability/subagent-tree';

export interface SpendBarProps {
  segments: SpendSegment[];
  total: number;
  scaleMax: number;
  className?: string;
}

// Custom CSS bar (DD-4) — Progress is single-color and Recharts drags in axes/containers.
// Track + a width-animated fill subdivided into per-model color segments (FR-6, NFR-5).
export function SpendBar({ segments, total, scaleMax, className }: SpendBarProps) {
  const fillPct = scaleMax > 0 ? (total / scaleMax) * 100 : 0;
  return (
    <div className={cn('h-3.5 rounded-md bg-muted overflow-hidden flex', className)} role="presentation">
      <div className="flex h-full transition-[width] duration-300" style={{ width: `${fillPct}%` }}>
        {segments.map((seg) => (
          <div
            key={seg.model}
            className="h-full"
            style={{
              width: total > 0 ? `${(seg.tokens / total) * 100}%` : '0%',
              background: `var(${modelColor(seg.model)})`,   // token name only — never a literal (NFR-2, DD-2)
            }}
          />
        ))}
      </div>
    </div>
  );
}
