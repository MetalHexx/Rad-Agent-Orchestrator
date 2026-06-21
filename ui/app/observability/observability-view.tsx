"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useObservabilityLive } from "@/hooks/use-observability-live";
import { SummaryCards } from "@/components/observability/summary-cards";
import { SpendRateChart } from "@/components/observability/spend-rate-chart";
import { FilterSelect } from "@/components/observability/filter-select";
import { SessionTable } from "@/components/observability/session-table";
import { ObservabilitySubHeader } from "@/components/observability/observability-sub-header";
import { deriveSessions, rowsInWindow, rowsSince } from "@/lib/observability/sessions";
import { countActiveNow } from "@/lib/observability/live-active";
import { fitToSession } from "@/lib/observability/fit-to-session";
import { retentionFloorMs } from "@/lib/time-range/range";
import { freshness } from "@/lib/observability/freshness";
import { readViewState, writeViewState, type ViewState } from "@/lib/time-range/url-state";
import { useTimeRangeWindow } from "@/hooks/use-time-range-window";
import { useSpendRateChart } from "@/hooks/use-spend-rate-chart";
import { useUrlViewState } from "@/hooks/use-url-view-state";

const HelpPanel = dynamic(
  () => import("@/components/observability/help-panel").then((m) => m.HelpPanel),
  { ssr: false }
);

export function ObservabilityView() {
  const { range, setRange, window: tw, now, floorMs, effectiveTick, manualTick, refreshNow } = useTimeRangeWindow();
  const { rangeStart, rangeEnd } = tw;

  const { rows, todayRows } = useObservabilityLive({ rangeStart, rangeEnd, manualTick });

  const [helpOpen, setHelpOpen] = React.useState(false);
  const [worktree, setWorktree] = React.useState<string>("All");
  const [session, setSession] = React.useState<string>("All");
  const filtered = worktree !== "All" || session !== "All";

  // URL: range + filters (FR-11, AD-5, AD-6). Memoize so the persist effect tracks value change.
  const viewState = React.useMemo<ViewState>(() => ({ range, worktree, session }), [range, worktree, session]);
  const applyViewState = React.useCallback((vs: ViewState) => {
    setRange(vs.range); setWorktree(vs.worktree); setSession(vs.session);
  }, [setRange]);
  useUrlViewState({ read: readViewState, write: writeViewState }, applyViewState, viewState);

  // Lower-bounded to rangeStart, no upper clamp so the live tail surfaces immediately (FR-11).
  const windowedRows = React.useMemo(() => rowsSince([...rows.values()], rangeStart), [rows, rangeStart]);
  const allSessions = React.useMemo(() => deriveSessions(windowedRows), [windowedRows]);
  const worktrees = React.useMemo(() => [...new Set(allSessions.map((s) => s.worktree ?? ""))], [allSessions]);
  const sessionsAfterWorktree = React.useMemo(() => {
    if (worktree === "All") return allSessions;
    return allSessions.filter((s) => (s.worktree ?? "unknown") === worktree);
  }, [allSessions, worktree]);
  const sessionIds = React.useMemo(() => sessionsAfterWorktree.map((s) => s.sessionId), [sessionsAfterWorktree]);
  const filteredSessions = React.useMemo(() => {
    if (session === "All") return sessionsAfterWorktree;
    return sessionsAfterWorktree.filter((s) => s.sessionId === session);
  }, [sessionsAfterWorktree, session]);

  // Active-Now from the system-wide today baseline, not the filtered window (FR-11).
  const activeNow = React.useMemo(() => countActiveNow(deriveSessions(todayRows), now), [todayRows, now]);

  const { latestMs, msSinceActivity } = freshness(rows.values(), now);

  // Session selection pins the range to the session start; clearing leaves range untouched (FR-11, AD-10).
  const handleSession = React.useCallback((id: string) => {
    setSession(id);
    if (id !== "All") {
      const s = allSessions.find((x) => x.sessionId === id);
      if (s) setRange(fitToSession(s.startedMs, retentionFloorMs(Date.now())));
    }
  }, [allSessions, setRange]);

  const chartRows = React.useMemo(
    () => rowsInWindow(filteredSessions.flatMap((s) => s.rows), rangeStart, rangeEnd),
    [filteredSessions, rangeStart, rangeEnd]
  );
  const chart = useSpendRateChart(chartRows, tw);

  return (
    <>
      <ObservabilitySubHeader
        ariaLabel="All Sessions page"
        title="All Sessions"
        subtitle="System-wide token usage"
        msSinceActivity={latestMs > 0 ? msSinceActivity : null}
        range={range}
        onRangeChange={setRange}
        rangeMin={floorMs}
        rangeMax={effectiveTick}
        scopeLabel="All sessions"
        onRefresh={refreshNow}
        onHelp={() => setHelpOpen(true)}
        filters={
          <>
            <FilterSelect label="Worktree" value={worktree} options={worktrees} onChange={setWorktree} />
            <FilterSelect label="Session" value={session} options={sessionIds} onChange={handleSession} />
          </>
        }
      />
      <main id="main-content" className="px-6 py-[var(--space-4)] space-y-[var(--space-4)]">
        <SummaryCards sessions={filteredSessions} activeNow={activeNow} />
        <SpendRateChart data={chart.data} series={chart.series} title="Token Spend Rate" rangeStart={rangeStart} rangeEnd={rangeEnd} filtered={filtered} />
        <SessionTable sessions={filteredSessions} now={now} rangeStart={rangeStart} rangeEnd={rangeEnd} nominalWindowMs={tw.nominalWindowMs} />
        <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} />
      </main>
    </>
  );
}
