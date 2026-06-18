"use client";
import * as React from "react";
import type { ObservabilityUsageRow } from "@rad-orchestration/telemetry";
import type { SSEEvent } from "@/types/events";
import { useSSEContext } from "@/hooks/use-sse-context";
import { upsertRows } from "@/lib/observability/sessions";
import { canLoadEarlier, previousUtcDay } from "@/lib/observability/day-window";

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
async function fetchDay(date: string): Promise<ObservabilityUsageRow[]> {
  const res = await fetch(`/api/observability/usage?startDate=${date}&endDate=${date}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.rows ?? []) as ObservabilityUsageRow[];
}

export function useObservabilityLive() {
  const { subscribe, sseStatus } = useSSEContext();
  const [rows, setRows] = React.useState<Map<string, ObservabilityUsageRow>>(new Map());
  const [earliestDay, setEarliestDay] = React.useState<string>(() => utcDay(new Date()));
  const merge = React.useCallback((incoming: ObservabilityUsageRow[]) => setRows((p) => upsertRows(p, incoming)), []);

  // initial: today's snapshot
  React.useEffect(() => { void fetchDay(utcDay(new Date())).then(merge); }, [merge]);

  // live: telemetry_rows off the shared connection (AD-1)
  React.useEffect(() => subscribe((ev: SSEEvent) => {
    if (ev.type === "telemetry_rows") merge((ev.payload as { rows: ObservabilityUsageRow[] }).rows);
  }), [subscribe, merge]);

  // self-heal: refetch today + upsert on genuine reconnect (AD-5, NFR-4)
  const connectedOnce = React.useRef(false);
  React.useEffect(() => {
    if (sseStatus === "connected") {
      if (connectedOnce.current) void fetchDay(utcDay(new Date())).then(merge);
      connectedOnce.current = true;
    }
  }, [sseStatus, merge]);

  const loadEarlier = React.useCallback(() => {
    const today = utcDay(new Date());
    if (!canLoadEarlier(earliestDay, today)) return;
    const day = previousUtcDay(earliestDay);
    setEarliestDay(day);
    void fetchDay(day).then(merge);
  }, [earliestDay, merge]);

  return { rows, earliestDay, loadEarlier };
}
