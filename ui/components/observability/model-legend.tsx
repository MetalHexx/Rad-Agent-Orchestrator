import * as React from 'react';
import { modelColor } from '@/lib/observability/model-color';

const LEGEND_MODELS = ['opus', 'sonnet', 'haiku'] as const;   // single key for the panel (FR-12, DD-2)

export function ModelLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {LEGEND_MODELS.map((m) => (
        <span key={m} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: `var(${modelColor(m)})` }} aria-hidden="true" />
          {m}
        </span>
      ))}
    </div>
  );
}
