import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { timeBucketedRateByModel, type ModelRatePoint } from '@/lib/observability/sessions';
import { modelColor } from '@/lib/observability/model-color';
import type { TimeWindow } from '@/lib/observability/time-window';

// Structurally identical to the chart component's SpendRateSeries — declared here so the
// lib owns the data contract and never imports a component (NFR-2 layering). TS structural
// typing keeps `series` assignable to <SpendRateChart series=...> with no import.
export interface SpendRateSeries { key: string; label: string; cssVar: string; }
export interface SpendRateChartModel { data: ModelRatePoint[]; series: SpendRateSeries[]; }

/** Default chart visibility: only the aggregate "All models" (total) line shows on load.
 *  Per-model lines are opt-in via the legend (FR-4). */
export const DEFAULT_SHOWN_KEYS: ReadonlySet<string> = new Set(['total']);

/** Keys of the series that should render, given the user's current opt-in set. Visibility is a
 *  PURE function of (series, shown) with no dependence on render order — a model key that first
 *  appears after mount (async data load / SSE live-tail) is hidden until the user opts it in, so
 *  the per-model lines never flash in before being hidden. */
export function visibleSeriesKeys(series: SpendRateSeries[], shown: ReadonlySet<string>): string[] {
  return series.map((s) => s.key).filter((k) => shown.has(k));
}

/** Bucket already-scoped rows over a TimeWindow into chart data + series descriptors. The
 *  blue total plus one token-colored line per model present, sorted (AD-3, FR-3). */
export function buildSpendRateChart(rows: ObservabilityUsageRow[], window: TimeWindow): SpendRateChartModel {
  const data = timeBucketedRateByModel(rows, window.chartBucketOpts());
  const models = [...new Set(rows.map((r) => r.model))].sort();
  const series: SpendRateSeries[] = [
    { key: 'total', label: 'All models', cssVar: '--chart-2' },
    ...models.map((m) => ({ key: m, label: m, cssVar: modelColor(m) })),
  ];
  return { data, series };
}
