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
  /** Uppercased muted line rendered beneath `children`, e.g. `TASK`, `RETRY`, `PHASE`, `READY`. Omitted when unset. */
  sublabel?: string;
  /**
   * Named size, resolved to a fraction of the shared `RING_DIAMETER` via
   * `RING_SIZE_SCALE` (default `'full'` = 1). A view expresses intent as a
   * size step, not a raw fraction — the primitive owns the pixel math, and
   * every derived radius/stroke scales proportionally (they all key off
   * `RING_STROKE_FRACTION`), so a smaller ring stays visually consistent
   * rather than needing a separately-tuned geometry. The `RingSlot` still
   * reserves the full `RING_DIAMETER`, so a sub-`'full'` ring just centers
   * within that reserved box and the card's footprint is unchanged.
   */
  size?: RingSize;
}

export type RingSize = 'xs' | 'sm' | 'md' | 'lg' | 'full';

/** Fraction of `RING_DIAMETER` each named size renders at. */
const RING_SIZE_SCALE: Record<RingSize, number> = {
  xs: 0.4,
  sm: 0.5,
  md: 0.6,
  lg: 0.8,
  full: 1,
};

/**
 * Radial thickness of the arc/track band as a fraction of the ring radius —
 * the single source both modes derive their stroke from so they can't drift
 * apart. Determinate expresses it as `innerRadius`/`outerRadius` pixel radii
 * (see below); indeterminate expresses it as a pixel stroke for its CSS
 * mask/border. Both read this one constant.
 */
const RING_STROKE_FRACTION = 0.28;
const ARC_CORNER_RADIUS = 6;
/** Sweep of the indeterminate arc, in degrees (a partial ring, not a full circle). */
const INDETERMINATE_SWEEP_DEG = 300;

/**
 * Derives every pixel dimension the ring needs from its rendered `diameter`.
 * Kept as one function so every named size scales identically off the shared
 * `RING_STROKE_FRACTION` — a smaller size is a true proportional shrink, not
 * a separately-tuned second geometry.
 *
 * `innerRadius`/`outerRadius` are what `<RadialBarChart>` receives, in pixels
 * (not the `%` strings recharts examples typically use). recharts positions a
 * radial chart's sole bar via an implicit, single-category `radiusAxis` band;
 * with exactly one bar (our gauge always has one), it renders the arc
 * *centered* on the band's declared inner edge — inset by half the band's own
 * thickness — rather than literally spanning `[innerRadius, outerRadius]` as
 * declared. Declaring a band centered on the ring's true outer radius
 * (`radius`) instead of its true inner radius pre-compensates for that shift,
 * so the rendered arc lands exactly on `[radius - stroke, radius]` — flush with
 * the ring's box. Confirmed against rendered SVG geometry, not just recharts'
 * prop docs (see `ring.test.tsx`).
 */
function ringGeometry(diameter: number) {
  const radius = diameter / 2;
  const stroke = Math.round(radius * RING_STROKE_FRACTION);
  return {
    diameter,
    radius,
    stroke,
    innerRadius: radius - stroke / 2,
    outerRadius: radius + stroke / 2,
  };
}

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
export function Ring({ value, max, color, mode, children, sublabel, size = 'full' }: RingProps) {
  const { diameter, stroke, innerRadius, outerRadius } = ringGeometry(
    Math.round(RING_DIAMETER * RING_SIZE_SCALE[size]),
  );
  return (
    <div className="relative" style={{ width: diameter, height: diameter }}>
      {mode === 'determinate' ? (
        <RadialBarChart
          width={diameter}
          height={diameter}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          barCategoryGap={0}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
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
            style={{ border: `${stroke}px solid var(--muted)` }}
            aria-hidden="true"
          />
          <div
            data-ring-mode="indeterminate"
            className="absolute inset-0 animate-spin rounded-full"
            style={{
              background: `conic-gradient(from 0deg, transparent 0deg, ${color} ${INDETERMINATE_SWEEP_DEG}deg, transparent 360deg)`,
              WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
              mask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
            }}
            aria-hidden="true"
          />
        </>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        {children}
        {sublabel && (
          // Constrain the sublabel to the ring's inner clear diameter (box minus
          // both stroke bands) and center it, so a two-word label wraps cleanly
          // inside the ring instead of bleeding past the colored band.
          <span
            className="text-center text-[10px] font-medium uppercase leading-tight tracking-wide text-muted-foreground"
            style={{ maxWidth: diameter - stroke * 2 - 4 }}
          >
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}
