"use client";
import * as React from "react";
import type { ObservabilityUsageRow } from "@rad-orchestration/telemetry";
import type { SSEEvent } from "@/types/events";
import { useSSEContext } from "@/hooks/use-sse-context";
import { upsertRows } from "@/lib/observability/sessions";
import { rangeUtcDates } from "@/lib/observability/time-range";

async function fetchDay(date: string): Promise<ObservabilityUsageRow[]> {
  const res = await fetch(`/api/observability/usage?startDate=${date}&endDate=${date}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.rows ?? []) as ObservabilityUsageRow[];
}

async function fetchRange(startMs: number, endMs: number): Promise<ObservabilityUsageRow[]> {
  const dates = rangeUtcDates(startMs, endMs);
  const results = await Promise.all(dates.map(fetchDay));
  return results.flat();
}

export interface UseObservabilityLiveOptions {
  rangeStart: number;
  rangeEnd: number;
}

export function useObservabilityLive({ rangeStart, rangeEnd }: UseObservabilityLiveOptions = { rangeStart: Date.now() - 24 * 60 * 60 * 1000, rangeEnd: Date.now() }) {
  const { subscribe, sseStatus } = useSSEContext();
  const [rows, setRows] = React.useState<Map<string, ObservabilityUsageRow>>(new Map());
  const merge = React.useCallback((incoming: ObservabilityUsageRow[]) => setRows((p) => upsertRows(p, incoming)), []);

  // initial + range-change: fetch all dates in the selected window
  React.useEffect(() => {
    void fetchRange(rangeStart, rangeEnd).then(merge);
  }, [rangeStart, rangeEnd, merge]);

  // live: telemetry_rows off the shared connection (AD-1)
  React.useEffect(() => subscribe((ev: SSEEvent) => {
    if (ev.type === "telemetry_rows") merge((ev.payload as { rows: ObservabilityUsageRow[] }).rows);
  }), [subscribe, merge]);

  // self-heal: refetch range + upsert on genuine reconnect (AD-5, NFR-4)
  const connectedOnce = React.useRef(false);
  React.useEffect(() => {
    if (sseStatus === "connected") {
      if (connectedOnce.current) void fetchRange(rangeStart, rangeEnd).then(merge);
      connectedOnce.current = true;
    }
  }, [sseStatus, rangeStart, rangeEnd, merge]);

  return { rows };
}
