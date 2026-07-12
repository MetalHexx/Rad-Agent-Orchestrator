import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { timeBucketedRateByModel, type ModelRatePoint } from '@/lib/observability/sessions';
import { modelColor } from '@/lib/observability/model-color';
import type { TimeWindow } from '@/lib/observability/time-window';

// Structurally identical to the chart component's SpendRateSeries — declared here so the
// lib owns the data contract and never imports a component (NFR-2 layering). TS structural
// typing keeps `series` assignable to <SpendRateChart series=...> with no import.
export interface SpendRateSeries { key: string; label: string; cssVar: string; }
export interface SpendRateChartModel { data: ModelRatePoint[]; series: SpendRateSeries[]; }

/** Default chart visibility: every model line present in the data shows on load. There is no
 *  aggregate "All models" option — it isn't a real filterable dimension, so it never appears as
 *  a series (FR-4). Per-model lines are opt-OUT via the legend: this tracks explicit hide clicks,
 *  starting empty so nothing is hidden until the user hides it. */
export const DEFAULT_HIDDEN_KEYS: ReadonlySet<string> = new Set();

/** Keys of the series that should render, given the user's current hidden set. Visibility is a
 *  PURE function of (series, hidden) with no dependence on render order — a model key that first
 *  appears after mount (async data load / SSE live-tail) is shown immediately, matching every
 *  other model already on screen, since "hidden" only ever grows from an explicit legend click. */
export function visibleSeriesKeys(series: SpendRateSeries[], hidden: ReadonlySet<string>): string[] {
  return series.map((s) => s.key).filter((k) => !hidden.has(k));
}

/** Bucket already-scoped rows over a TimeWindow into chart data + series descriptors: one
 *  token-colored line per model actually present, sorted (AD-3, FR-3). A model that isn't in the
 *  data never appears as a selectable series — there's nothing to filter until it shows up. */
export function buildSpendRateChart(rows: ObservabilityUsageRow[], window: TimeWindow): SpendRateChartModel {
  const data = timeBucketedRateByModel(rows, window.chartBucketOpts());
  const models = [...new Set(rows.map((r) => r.model))].sort();
  const series: SpendRateSeries[] = models.map((m) => ({ key: m, label: m, cssVar: modelColor(m) }));
  return { data, series };
}
