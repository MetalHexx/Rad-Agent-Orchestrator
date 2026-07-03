import * as React from 'react';
import { RadialBarChart } from 'recharts';
import { RadialBar, PolarAngleAxis } from '@/components/observability/recharts-compat';
import { RING_DIAMETER } from './card-slots';

export interface RingProps {
  /** Determinate arc value. */
  value: number;
  /** Arc domain upper bound; `value` maps to sweep across `[0, max]`. */
  max: number;
  /** Arc fill — a tier CSS var, e.g. `var(--tier-execution)`. */
  color: string;
  mode: 'determinate' | 'indeterminate';
  /** Center content (number / glyph), absolutely centered by the ring. */
  children?: React.ReactNode;
  /** Small-caps muted line rendered beneath `children`, e.g. `TASK`, `RETRY`, `PHASE`, `READY`. Omitted when unset. */
  sublabel?: string;
}

/**
 * Radial thickness of the arc/track band as a fraction of the ring radius —
 * the single source both modes derive their stroke from so they can't drift
 * apart. Determinate expresses it as `innerRadius` (recharts computes the
 * band from `outerRadius - innerRadius`); indeterminate expresses it as a
 * pixel stroke for its CSS mask/border. Both read this one constant.
 */
const RING_STROKE_FRACTION = 0.28;
const INNER_RADIUS = `${Math.round((1 - RING_STROKE_FRACTION) * 100)}%`;
const OUTER_RADIUS = '100%';
const ARC_CORNER_RADIUS = 6;
/** Sweep of the indeterminate arc, in degrees (a partial ring, not a full circle). */
const INDETERMINATE_SWEEP_DEG = 300;
const RING_STROKE = Math.round((RING_DIAMETER / 2) * RING_STROKE_FRACTION);

/**
 * Clamps an arc value into `[0, max]` so out-of-range input (a negative or an
 * over-count) can never map past the arc domain and wrap the sweep.
 */
export function clampRingValue(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (max <= 0) return 0;
  return value > max ? max : value;
}

/**
 * A fixed-size ring: a determinate arc or an indeterminate CSS conic sweep,
 * both drawn over the same muted full-circle track at the same diameter and
 * stroke so the two modes read as one primitive. Presentational only — it
 * reads no pipeline state. Center content is supplied via `children` (the
 * primary glyph/number) plus an optional `sublabel` beneath it, both centered
 * absolutely so they stay put regardless of arc value or mode.
 *
 * The indeterminate sweep rotates via Tailwind's `animate-spin`, which the
 * global `prefers-reduced-motion` rule freezes to a static partial ring.
 */
export function Ring({ value, max, color, mode, children, sublabel }: RingProps) {
  return (
    <div className="relative" style={{ width: RING_DIAMETER, height: RING_DIAMETER }}>
      {mode === 'determinate' ? (
        <RadialBarChart
          width={RING_DIAMETER}
          height={RING_DIAMETER}
          cx="50%"
          cy="50%"
          innerRadius={INNER_RADIUS}
          outerRadius={OUTER_RADIUS}
          startAngle={90}
          endAngle={-270}
          data={[{ value: clampRingValue(value, max) }]}
        >
          <PolarAngleAxis type="number" domain={[0, max]} angleAxisId={0} tick={false} axisLine={false} />
          <RadialBar
            dataKey="value"
            background={{ fill: 'var(--muted)' }}
            cornerRadius={ARC_CORNER_RADIUS}
            fill={color}
            isAnimationActive={false}
          />
        </RadialBarChart>
      ) : (
        <>
          <div
            data-ring-track="true"
            className="absolute inset-0 rounded-full"
            style={{ border: `${RING_STROKE}px solid var(--muted)` }}
            aria-hidden="true"
          />
          <div
            data-ring-mode="indeterminate"
            className="absolute inset-0 animate-spin rounded-full"
            style={{
              background: `conic-gradient(from 0deg, transparent 0deg, ${color} ${INDETERMINATE_SWEEP_DEG}deg, transparent 360deg)`,
              WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${RING_STROKE}px), #000 calc(100% - ${RING_STROKE}px))`,
              mask: `radial-gradient(farthest-side, transparent calc(100% - ${RING_STROKE}px), #000 calc(100% - ${RING_STROKE}px))`,
            }}
            aria-hidden="true"
          />
        </>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
        {sublabel && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{sublabel}</span>
        )}
      </div>
    </div>
  );
}
