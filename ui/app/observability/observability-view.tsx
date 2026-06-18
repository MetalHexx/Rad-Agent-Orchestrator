"use client";

import * as React from "react";
import { useObservabilityLive } from "@/hooks/use-observability-live";
import { ActivityDot } from "@/components/observability/activity-dot";
import { SummaryCards } from "@/components/observability/summary-cards";
import { TotalRateChart } from "@/components/observability/total-rate-chart";
import { ControlBar } from "@/components/observability/control-bar";
import { deriveSessions, timeBucketedRate } from "@/lib/observability/sessions";
import { isActive } from "@/lib/observability/activity-dot-color";
import { canLoadEarlier } from "@/lib/observability/day-window";
import { SessionTable } from "@/components/observability/session-table";
import { HelpPanel } from "@/components/observability/help-panel";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

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

// UTC date string for today
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ObservabilityView() {
  const { rows, earliestDay, loadEarlier } = useObservabilityLive();
  const now = useNow(1000);

  // Help panel state (FR-13)
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Filter state (FR-6)
  const [worktree, setWorktree] = React.useState<string>("All");
  const [session, setSession] = React.useState<string>("All");

  const allSessions = React.useMemo(() => deriveSessions(rows), [rows]);

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

  return (
    <main id="main-content" className="mx-auto w-full max-w-screen-2xl px-6 py-6">
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

      <ControlBar
        worktrees={worktrees}
        worktree={worktree}
        onWorktree={setWorktree}
        sessions={sessionIds}
        session={session}
        onSession={setSession}
        onEarlier={loadEarlier}
        canEarlier={canLoadEarlier(earliestDay, todayUtc())}
        onHelp={() => setHelpOpen(true)}
      />
      <SummaryCards sessions={filteredSessions} activeNow={activeNow} />
      <TotalRateChart data={timeBucketedRate([...rows.values()], { endMs: now, windowMs: 60*60*1000, buckets: 60 })} />
      <SessionTable sessions={filteredSessions} now={now} />
      <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} />
    </main>
  );
}
