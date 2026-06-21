import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { timeBucketedRateByModel, type ModelRatePoint } from '@/lib/observability/sessions';
import { modelColor } from '@/lib/observability/model-color';
import type { TimeWindow } from '@/lib/observability/time-window';

// Structurally identical to the chart component's SpendRateSeries — declared here so the
// lib owns the data contract and never imports a component (NFR-2 layering). TS structural
// typing keeps `series` assignable to <SpendRateChart series=...> with no import.
export interface SpendRateSeries { key: string; label: string; cssVar: string; }
export interface SpendRateChartModel { data: ModelRatePoint[]; series: SpendRateSeries[]; }

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
