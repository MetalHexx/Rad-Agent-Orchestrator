"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useObservabilityLive } from "@/hooks/use-observability-live";
import { ActivityDot } from "@/components/observability/activity-dot";
import { SummaryCards } from "@/components/observability/summary-cards";
import { TotalRateChart } from "@/components/observability/total-rate-chart";
import { FilterSelect } from "@/components/observability/filter-select";
import { TimeRangePicker } from "@/components/time-range/time-range-picker";
import { deriveSessions, timeBucketedRate, rowsInWindow, rowsSince } from "@/lib/observability/sessions";
import { isActive } from "@/lib/observability/activity-dot-color";
import { SessionTable } from "@/components/observability/session-table";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { bucketsForWindow } from "@/lib/observability/time-range";
import { type TimeRange, DEFAULT_RANGE, retentionFloorMs, resolveWindow, isLive } from "@/lib/time-range/range";
import { windowMsForBuckets } from "@/lib/observability/bucket-count";
import { fitToSession } from "@/lib/observability/fit-to-session";
import { readViewState, writeViewState } from "@/lib/time-range/url-state";

// HelpPanel renders MarkdownRenderer (react-markdown), whose default export
// resolves to `undefined` in Next's App-Router server bundle, crashing this
// statically-prerendered route. It is a click-triggered client drawer with no
// SSR value, so load it client-only.
const HelpPanel = dynamic(
  () => import("@/components/observability/help-panel").then((m) => m.HelpPanel),
  { ssr: false }
);

function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatAgo(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function ObservabilityView() {
  // Time range state (FR-1, AD-9)
  const [range, setRange] = React.useState<TimeRange>(DEFAULT_RANGE);

  // 1-second clock: freshness text and ActivityDot decay only (AD-3)
  const now = useNow(1000);

  // Re-bucket tick: advances live windows every 5 s, frozen for absolute ranges (FR-8, AD-11)
  const tick = useNow(isLive(range) ? 5000 : 3_600_000);

  // Manual refresh state: advances the effective tick to now on demand (FR-2)
  const [manualTick, setManualTick] = React.useState(0);
  const effectiveTick = Math.max(tick, manualTick);

  // Compute window from the selected range and the refresh tick
  const floorMs = retentionFloorMs(tick);
  const { startMs: rangeStart, endMs: rangeEnd } = React.useMemo(
    () => resolveWindow(range, effectiveTick, floorMs),
    [range, effectiveTick, floorMs]
  );

  const { rows } = useObservabilityLive({ rangeStart, rangeEnd, manualTick });

  // Help panel state (FR-13)
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Filter state (FR-6)
  const [worktree, setWorktree] = React.useState<string>("All");
  const [session, setSession] = React.useState<string>("All");

  // Hydrate range + filters from the URL query string on first mount (FR-12, AD-8).
  // Uses window.location.search directly — never useSearchParams() — so this component
  // stays renderable without a router context (NFR-4, keeps existing tests green).
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.toString()) return; // nothing in the URL → keep defaults
    const vs = readViewState(params);
    setRange(vs.range);
    setWorktree(vs.worktree);
    setSession(vs.session);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  // Persist range + filters back to the URL shallowly on every change (FR-12, AD-8).
  // Mirrors the projects-page precedent: window.history.replaceState (no router.push)
  // so there are no remounts and no Next router dependency here.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const qs = writeViewState(new URLSearchParams(window.location.search), { range, worktree, session });
    window.history.replaceState(null, '', `?${qs}`);
  }, [range, worktree, session]);

  // Scope rows to the live tail: lower-bounded to rangeStart, no upper clamp so SSE
  // appends newer than the tick-pinned rangeEnd surface immediately (FR-9, AD-6).
  const windowedRows = React.useMemo(
    () => rowsSince([...rows.values()], rangeStart),
    [rows, rangeStart]
  );

  const allSessions = React.useMemo(() => deriveSessions(windowedRows), [windowedRows]);

  // Unique worktree paths seen across all sessions (absent → "unknown")
  const worktrees = React.useMemo(
    () => [...new Set(allSessions.map((s) => s.worktree ?? ""))],
    [allSessions]
  );

  // Apply worktree filter (mapping absent → "unknown" for comparison)
  const sessionsAfterWorktree = React.useMemo(() => {
    if (worktree === "All") return allSessions;
    return allSessions.filter((s) => (s.worktree ?? "unknown") === worktree);
  }, [allSessions, worktree]);

  // Session IDs visible after worktree filter
  const sessionIds = React.useMemo(
    () => sessionsAfterWorktree.map((s) => s.sessionId),
    [sessionsAfterWorktree]
  );

  // Apply session filter
  const filteredSessions = React.useMemo(() => {
    if (session === "All") return sessionsAfterWorktree;
    return sessionsAfterWorktree.filter((s) => s.sessionId === session);
  }, [sessionsAfterWorktree, session]);

  const activeNow = React.useMemo(
    () => filteredSessions.filter(s => isActive(now - s.lastMs)).length,
    [filteredSessions, now]
  );

  const latestMs = React.useMemo(() => {
    let max = 0;
    for (const row of rows.values()) {
      const t = Date.parse(row.timestamp);
      if (t > max) max = t;
    }
    return max;
  }, [rows]);

  const msSinceActivity = latestMs > 0 ? now - latestMs : Infinity;

  // Refresh now: advance manualTick to the current time, forcing a window recompute (FR-2)
  const handleRefreshNow = React.useCallback(() => { setManualTick(Date.now()); }, []);

  // Session selection: pin range to session start; clearing preserves the current range (FR-5, FR-6)
  const handleSession = React.useCallback((id: string) => {
    setSession(id);
    if (id !== "All") {
      const s = allSessions.find((x) => x.sessionId === id);
      if (s) setRange(fitToSession(s.startedMs, retentionFloorMs(Date.now())));
    }
    // clearing (id === "All") intentionally leaves `range` untouched (FR-6)
  }, [allSessions]);

  // Chart data: anchored to an absolute time grid so the curve's shape stays steady as the window
  // slides (no per-tick warp); the bucket COUNT comes from the nominal range so the grid size is
  // stable — deriving it from the live, retention-clamped window would make the snap circular
  // (FR-5, AD-3, NFR-4).
  const chartData = React.useMemo(
    () => timeBucketedRate(
      rowsInWindow([...rows.values()], rangeStart, rangeEnd),
      { endMs: rangeEnd, windowMs: rangeEnd - rangeStart, buckets: bucketsForWindow(windowMsForBuckets(range, effectiveTick)), anchor: "grid" }
    ),
    [rows, rangeStart, rangeEnd]
  );

  return (
    <main id="main-content" className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-[var(--space-5)] space-y-[var(--space-5)]">
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold text-foreground">All Sessions</h1>
          <p className="text-sm text-muted-foreground">System-wide token usage</p>
        </div>
        {latestMs > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                className="flex items-center gap-1.5 pb-0.5 cursor-default bg-transparent border-none p-0"
                aria-label={`Activity indicator: updated ${formatAgo(msSinceActivity)}`}
              >
                <ActivityDot msSinceActivity={msSinceActivity} />
                <span className="text-xs text-muted-foreground">updated {formatAgo(msSinceActivity)}</span>
              </TooltipTrigger>
              <TooltipContent>
                Live activity indicator — glows green when a session sent tokens recently, fades to grey when idle.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </header>

      <SummaryCards sessions={filteredSessions} activeNow={activeNow} />
      <TotalRateChart data={chartData} rangeStart={rangeStart} rangeEnd={rangeEnd} />
      <div className="flex flex-wrap items-center gap-[var(--space-4)]">
        <TimeRangePicker value={range} onChange={setRange} min={floorMs} max={effectiveTick} scopeLabel="All sessions" />
        <FilterSelect label="Worktree" value={worktree} options={worktrees} onChange={setWorktree} />
        <FilterSelect label="Session" value={session} options={sessionIds} onChange={handleSession} />
        <div className="flex-1" />
        <button type="button" aria-label="Refresh now" onClick={handleRefreshNow}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border">↻</button>
        <button type="button" aria-label="Help" onClick={() => setHelpOpen(true)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md">?</button>
      </div>
      <SessionTable sessions={filteredSessions} now={now} rangeStart={rangeStart} rangeEnd={rangeEnd} />
      <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} />
    </main>
  );
}
