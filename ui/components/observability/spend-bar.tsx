import * as React from 'react';
import { cn } from '@/lib/utils';
import { modelColor } from '@/lib/observability/model-color';
import { formatUsd } from '@/lib/observability/spend-display';
import type { SpendSegment } from '@/lib/observability/subagent-tree';

export interface SpendBarProps {
  segments: SpendSegment[];
  total: number;
  scaleMax: number;
  className?: string;
}

// Custom CSS bar (DD-4) — Progress is single-color and Recharts drags in axes/containers.
// Track + a width-animated fill subdivided into per-model color segments (FR-6, NFR-5).
// The bar itself stays role="presentation"; the per-model dollar split below it is real content.
export function SpendBar({ segments, total, scaleMax, className }: SpendBarProps) {
  const fillPct = scaleMax > 0 ? (total / scaleMax) * 100 : 0;
  return (
    <div className={className}>
      <div className="h-3.5 rounded-md bg-muted overflow-hidden flex" role="presentation">
        <div className="flex h-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${fillPct}%` }}>
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
      {segments.length > 1 && (
        <div className="flex flex-wrap gap-x-2 pt-0.5 text-[10px] tabular-nums text-muted-foreground">
          {segments.map((seg) => (
            <span key={seg.model} className="inline-flex items-center gap-1">
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ background: `var(${modelColor(seg.model)})` }}
                aria-hidden="true"
              />
              {seg.model} · {formatUsd(seg.dollars)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
