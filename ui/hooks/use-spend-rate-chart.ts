"use client";
import * as React from 'react';
import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { buildSpendRateChart, type SpendRateChartModel } from '@/lib/observability/spend-rate';
import type { TimeWindow } from '@/lib/observability/time-window';

/** Memoized chart-builder call site over page-scoped rows + the shared window (AD-6, FR-3). */
export function useSpendRateChart(rows: ObservabilityUsageRow[], window: TimeWindow): SpendRateChartModel {
  return React.useMemo(() => buildSpendRateChart(rows, window), [rows, window]);
}
