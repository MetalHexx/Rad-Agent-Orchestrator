"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { useObservabilityLive } from "@/hooks/use-observability-live";
import { SpendRateChart } from "@/components/observability/spend-rate-chart";
import { ObservabilitySubHeader } from "@/components/observability/observability-sub-header";
import { deriveSessions, rowsInWindow, rowsSince } from "@/lib/observability/sessions";
import { fitToSession } from "@/lib/observability/fit-to-session";
import { retentionFloorMs } from "@/lib/time-range/range";
import { freshness } from "@/lib/observability/freshness";
import { readRangeState, writeRangeState, type RangeState } from "@/lib/time-range/url-state";
import { useTimeRangeWindow } from "@/hooks/use-time-range-window";
import { useSpendRateChart } from "@/hooks/use-spend-rate-chart";
import { useUrlViewState } from "@/hooks/use-url-view-state";

const HelpPanel = dynamic(
  () => import("@/components/observability/help-panel").then((m) => m.HelpPanel),
  { ssr: false }
);

const SESSION_HELP_MD = "Help for the session view is coming soon.";
const shortId = (id: string) => (id.length > 8 ? id.slice(0, 8) : id);

export function SessionDetailView({ sessionId }: { sessionId: string }) {
  // Phase 1 — discover: open at the retention floor so the fetch window is guaranteed to
  // contain the session regardless of how old it is (AD-9).
  const discoveryRange = React.useMemo(
    () => ({ kind: "since" as const, startMs: retentionFloorMs(Date.now()) }),
    []
  );
  const { range, setRange, window: tw, now, floorMs, effectiveTick, manualTick, refreshNow } =
    useTimeRangeWindow(discoveryRange);
  const { rangeStart, rangeEnd } = tw;
  const { rows, ready } = useObservabilityLive({ rangeStart, rangeEnd, manualTick });

  const [helpOpen, setHelpOpen] = React.useState(false);

  // URL: range only (FR-8, AD-5). A deep-linked range overrides the auto-pin (AD-9).
  const urlHadRange = React.useRef<boolean>(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("range")
  );
  const rangeState = React.useMemo<RangeState>(() => ({ range }), [range]);
  const applyRangeState = React.useCallback((s: RangeState) => { setRange(s.range); }, [setRange]);
  useUrlViewState({ read: readRangeState, write: writeRangeState }, applyRangeState, rangeState);

  // Scope rows to this session (single-id lookup — the detail policy, AD-10).
  const sessionRows = React.useMemo(
    () => rowsSince([...rows.values()], rangeStart).filter((r) => r.sessionId === sessionId),
    [rows, rangeStart, sessionId]
  );
  const session = React.useMemo(
    () => deriveSessions(sessionRows).find((s) => s.sessionId === sessionId),
    [sessionRows, sessionId]
  );

  // Phase 2 — pin: once the session start is known, re-pin to fit-to-session unless the URL
  // already deep-linked a range. Runs once (AD-9, FR-6).
  const pinned = React.useRef(false);
  React.useEffect(() => {
    if (pinned.current || urlHadRange.current) return;
    if (session) { pinned.current = true; setRange(fitToSession(session.startedMs, retentionFloorMs(Date.now()))); }
  }, [session, setRange]);

  const { latestMs, msSinceActivity } = freshness(sessionRows, now);

  const chartRows = React.useMemo(
    () => rowsInWindow(sessionRows, rangeStart, rangeEnd),
    [sessionRows, rangeStart, rangeEnd]
  );
  const chart = useSpendRateChart(chartRows, tw);

  const allRowCount = rows.size;
  // Not-found: rows exist system-wide but none match this id even at the floor-deep window (FR-9).
  const notFound = !session && allRowCount > 0 && sessionRows.length === 0;

  const scopeTitle = `Session ${shortId(sessionId)}`;
  const subtitle = session?.worktree ?? "Single-session token usage";

  return (
    <>
      <ObservabilitySubHeader
        ariaLabel="Session detail page"
        title={scopeTitle}
        subtitle={subtitle}
        msSinceActivity={notFound ? null : (latestMs > 0 ? msSinceActivity : Infinity)}
        range={range}
        onRangeChange={setRange}
        rangeMin={floorMs}
        rangeMax={effectiveTick}
        scopeLabel={scopeTitle}
        onRefresh={refreshNow}
        onHelp={() => setHelpOpen(true)}
      />
      <main id="main-content" className="px-6 py-[var(--space-4)] space-y-[var(--space-4)]">
        {notFound ? (
          <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-[var(--space-4)] text-sm text-muted-foreground">
            Session not found (or aged out of the retention window).
          </div>
        ) : (
          <SpendRateChart data={chart.data} series={chart.series} title="Token Spend Rate · This Session" rangeStart={rangeStart} rangeEnd={rangeEnd} ready={ready} />
        )}
        <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} title="Session detail" content={SESSION_HELP_MD} />
      </main>
    </>
  );
}
