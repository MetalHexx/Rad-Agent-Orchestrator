"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useObservabilityLive } from "@/hooks/use-observability-live";
import { ActivityDot } from "@/components/observability/activity-dot";
import { SummaryCards } from "@/components/observability/summary-cards";
import { TotalRateChart } from "@/components/observability/total-rate-chart";
import { ControlBar } from "@/components/observability/control-bar";
import { deriveSessions, timeBucketedRate, rowsInWindow, rowsSince } from "@/lib/observability/sessions";
import { isActive } from "@/lib/observability/activity-dot-color";
import { SessionTable } from "@/components/observability/session-table";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { type QuickRangeId, DEFAULT_RANGE_ID, rangeWindow, bucketsForWindow } from "@/lib/observability/time-range";

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
  // Range + refresh state (FR-3, FR-4, FR-5, AD-3)
  const [rangeId, setRangeId] = React.useState<QuickRangeId>(DEFAULT_RANGE_ID);
  const [refreshMs, setRefreshMs] = React.useState(10000);

  // 1-second clock: freshness text and ActivityDot decay only (AD-3)
  const now = useNow(1000);

  // Slow refresh tick: drives re-bucketing (AD-3) — when Off, poll at 1-hour cadence
  const tick = useNow(refreshMs || 3_600_000);

  // Compute window from the selected range and the refresh tick
  const { startMs: rangeStart, endMs: rangeEnd } = React.useMemo(
    () => rangeWindow(rangeId, tick),
    [rangeId, tick]
  );

  const { rows } = useObservabilityLive({ rangeStart, rangeEnd });

  // Help panel state (FR-13)
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Filter state (FR-6)
  const [worktree, setWorktree] = React.useState<string>("All");
  const [session, setSession] = React.useState<string>("All");

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

  // Refresh now: advance tick by resetting range window
  const handleRefreshNow = React.useCallback(() => {
    setRangeId(id => id);
  }, []);

  // Chart data: scoped to window with adaptive bucket count (FR-5, AD-3, NFR-4)
  const chartData = React.useMemo(
    () => timeBucketedRate(
      rowsInWindow([...rows.values()], rangeStart, rangeEnd),
      { endMs: rangeEnd, windowMs: rangeEnd - rangeStart, buckets: bucketsForWindow(rangeEnd - rangeStart) }
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
      <ControlBar
        rangeId={rangeId}
        onRange={setRangeId}
        refreshMs={refreshMs}
        onRefreshMs={setRefreshMs}
        onRefreshNow={handleRefreshNow}
        worktrees={worktrees}
        worktree={worktree}
        onWorktree={setWorktree}
        sessions={sessionIds}
        session={session}
        onSession={setSession}
        onHelp={() => setHelpOpen(true)}
      />
      <SessionTable sessions={filteredSessions} now={now} />
      <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} />
    </main>
  );
}
