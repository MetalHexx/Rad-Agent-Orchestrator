"use client";
import * as React from "react";
import type { ObservabilityUsageRow } from "@rad-orchestration/telemetry";
import type { SSEEvent } from "@/types/events";
import { useSSEContext } from "@/hooks/use-sse-context";
import { upsertRows } from "@/lib/observability/sessions";
import { rangeUtcDates } from "@/lib/observability/time-range";
import { utcDateString } from "@/lib/time-range/timezone";

async function fetchDay(date: string): Promise<ObservabilityUsageRow[]> {
  const res = await fetch(`/api/observability/usage?startDate=${date}&endDate=${date}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.rows ?? []) as ObservabilityUsageRow[];
}

async function fetchDates(dates: string[]): Promise<ObservabilityUsageRow[]> {
  const results = await Promise.all(dates.map(fetchDay));
  return results.flat();
}

export interface UseObservabilityLiveOptions {
  rangeStart: number;
  rangeEnd: number;
  /** Bumped by the "Refresh now" button to force a one-off backfill (FR-2). 0 = never pressed. */
  manualTick?: number;
}

export function useObservabilityLive(
  { rangeStart, rangeEnd, manualTick = 0 }: UseObservabilityLiveOptions = {
    rangeStart: Date.now() - 24 * 60 * 60 * 1000,
    rangeEnd: Date.now(),
  }
) {
  const { subscribe, sseStatus } = useSSEContext();
  const [rows, setRows] = React.useState<Map<string, ObservabilityUsageRow>>(new Map());
  const merge = React.useCallback((incoming: ObservabilityUsageRow[]) => setRows((p) => upsertRows(p, incoming)), []);

  // Latches true once the first backfill resolves (monotonic — later range switches never reset it).
  // Lets the chart reserve its slot until real data is in hand, then fade it in, instead of painting
  // a flat, empty axis on mount and popping the data in a frame later.
  const [ready, setReady] = React.useState(false);

  // The set of UTC dates the window spans. The auto-refresh tick advances rangeStart/rangeEnd every
  // interval, but the *dates* only change at UTC-midnight rollover or when the user picks a different
  // range. Keying the fetch on this stable string (not the raw ms) is what stops the per-tick refetch
  // storm: this is a push-based view — live rows arrive via SSE (below), so we no longer poll the range.
  const dateKey = React.useMemo(() => rangeUtcDates(rangeStart, rangeEnd).join(","), [rangeStart, rangeEnd]);

  // Today's UTC partition key — stable across ticks so the today baseline fetch does not re-fire
  // every second. Used as the cache key for the system-wide, today-inclusive session set (FR-9, NFR-5).
  const todayKey = React.useMemo(() => utcDateString(Date.now()), []);

  // System-wide today rows — always fetched for the current UTC day regardless of the analyzed window.
  // This is the baseline for "Active Now" / activity indicators so that a deep-linked historical
  // absolute window still reports real-time activity correctly (FR-9, AD-7).
  const [todayRows, setTodayRows] = React.useState<Map<string, ObservabilityUsageRow>>(new Map());
  const mergeToday = React.useCallback((incoming: ObservabilityUsageRow[]) => setTodayRows((p) => upsertRows(p, incoming)), []);

  // Fetch today's partition once (stable todayKey means this only re-fires at UTC midnight rollover).
  React.useEffect(() => {
    void fetchDay(todayKey).then(mergeToday);
  }, [todayKey, mergeToday]);

  // initial load + date-set change (range switch / midnight rollover): fetch those dates once.
  // Latch `ready` after the first backfill settles so the chart can hold its slot until then;
  // setReady(true) is idempotent on later range switches, so it stays monotonic.
  React.useEffect(() => {
    void fetchDates(dateKey ? dateKey.split(",") : []).then((r) => { merge(r); setReady(true); });
  }, [dateKey, merge]);

  // live: telemetry_rows off the shared connection (AD-1) — the real-time channel.
  React.useEffect(() => subscribe((ev: SSEEvent) => {
    if (ev.type === "telemetry_rows") {
      const incoming = (ev.payload as { rows: ObservabilityUsageRow[] }).rows;
      merge(incoming);
      // Keep today baseline current: if the SSE row is from today, fold it in (FR-9, AD-7).
      const currentToday = utcDateString(Date.now());
      const todayIncoming = incoming.filter((r) => r.timestamp.startsWith(currentToday));
      if (todayIncoming.length > 0) mergeToday(todayIncoming);
    }
  }), [subscribe, merge, mergeToday]);

  // self-heal: refetch the date-set + upsert on genuine reconnect (AD-5, NFR-4).
  const connectedOnce = React.useRef(false);
  React.useEffect(() => {
    if (sseStatus === "connected") {
      if (connectedOnce.current) {
        void fetchDates(dateKey ? dateKey.split(",") : []).then(merge);
        void fetchDay(utcDateString(Date.now())).then(mergeToday);
      }
      connectedOnce.current = true;
    }
  }, [sseStatus, dateKey, merge, mergeToday]);

  // manual "Refresh now": force a one-off backfill of the current date-set (FR-2). The auto tick no
  // longer fetches, so this is the button's remaining job. The ref guard keeps a date-set change from
  // re-triggering it, and the initial 0 is ignored so it only fires on an actual press.
  const lastManualTick = React.useRef(0);
  React.useEffect(() => {
    if (manualTick <= 0 || manualTick === lastManualTick.current) return;
    lastManualTick.current = manualTick;
    void fetchDates(dateKey ? dateKey.split(",") : []).then(merge);
    void fetchDay(utcDateString(Date.now())).then(mergeToday);
  }, [manualTick, dateKey, merge, mergeToday]);

  return { rows, todayRows, ready };
}
