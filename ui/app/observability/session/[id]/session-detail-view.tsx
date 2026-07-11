"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { useObservabilityLive } from "@/hooks/use-observability-live";
import { SpendRateChart } from "@/components/observability/spend-rate-chart";
import { SessionSummaryCards } from "@/components/observability/session-summary-cards";
import { TokenBreakdown } from "@/components/observability/token-breakdown";
import { sumRawTokens } from "@/lib/observability/raw-tokens";
import { ObservabilitySubHeader } from "@/components/observability/observability-sub-header";
import { BackButton } from "@/components/ui/back-button";
import { AgentTree } from '@/components/observability/agent-tree';
import { AgentInspectorModal } from '@/components/observability/agent-inspector-modal';
import { buildSubagentTree } from '@/lib/observability/subagent-tree';
import { numberedAgentLabels } from '@/lib/observability/transcript-identity';
import { sessionWindowCoverage } from '@/lib/observability/window-coverage';
import { deriveSessions, rowsInWindow, rowsSince } from "@/lib/observability/sessions";
import type { SessionAgg } from '@/lib/observability/sessions';
import { fitToSession } from "@/lib/observability/fit-to-session";
import { retentionFloorMs } from "@/lib/time-range/range";
import type { TimeRange } from '@/lib/time-range/range';
import { freshness } from "@/lib/observability/freshness";
import { readRangeState, writeRangeState, type RangeState } from "@/lib/time-range/url-state";
import { useTimeRangeWindow } from "@/hooks/use-time-range-window";
import { useSpendRateChart } from "@/hooks/use-spend-rate-chart";
import { useUrlViewState } from "@/hooks/use-url-view-state";
import { useSessionAgents } from "@/hooks/use-agent-inspector";
import { SaveStarButton } from "@/components/observability/save-star-button";
import { fetchIsSaved, saveSession, unsaveSession } from "@/lib/observability/saved-client";

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

  // Windowed rows and windowed session for cards/tree/chart (AD-6 holds vs the SELECTED window).
  const windowRows = React.useMemo(
    () => rowsInWindow(sessionRows, rangeStart, rangeEnd),
    [sessionRows, rangeStart, rangeEnd]
  );
  const windowedSession = React.useMemo<SessionAgg | undefined>(() => {
    if (!session) return undefined;
    if (windowRows.length === 0) {
      return { sessionId, worktree: session.worktree, startedMs: rangeStart, lastMs: rangeStart, spend: 0, rows: [] };
    }
    return deriveSessions(windowRows).find((s) => s.sessionId === sessionId)
      ?? { sessionId, worktree: session.worktree, startedMs: rangeStart, lastMs: rangeStart, spend: 0, rows: [] };
  }, [session, windowRows, sessionId, rangeStart]);

  // Build the breakdown from windowRows → windowTotal === Total Spend (AD-6 now holds vs the SELECTED window).
  const subagentTree = React.useMemo(() => buildSubagentTree(windowRows), [windowRows]);
  // Authoritative numbering (coder 1 / Main Agent) from the table, keyed by transcriptId for the modal.
  const agentLabels = React.useMemo(() => numberedAgentLabels(subagentTree, sessionId), [subagentTree, sessionId]);
  const coverage = React.useMemo(
    () => sessionWindowCoverage([...rows.values()], sessionId, rangeStart, rangeEnd),
    [rows, sessionId, rangeStart, rangeEnd],
  );

  // Phase 2 — pin: once the session start is known and backfill is ready, re-pin to fit-to-session
  // unless the URL already deep-linked a range. Runs once (AD-9, FR-6).
  const pinned = React.useRef(false);
  const defaultRange = React.useRef<TimeRange | null>(null);
  const [hasDefault, setHasDefault] = React.useState(false);
  React.useEffect(() => {
    if (pinned.current || urlHadRange.current) return;
    if (ready && session) {                       // gate on ready so startedMs is the TRUE earliest event
      pinned.current = true;
      const nowMs = Date.now();                   // read once → floor + lead-in agree
      const fit = fitToSession(session.startedMs, retentionFloorMs(nowMs), nowMs);
      defaultRange.current = fit;
      setHasDefault(true);
      setRange(fit);
    }
  }, [ready, session, setRange]);

  const onResetRange = React.useCallback(() => {
    if (defaultRange.current) setRange(defaultRange.current);
  }, [setRange]);

  const { latestMs, msSinceActivity } = freshness(sessionRows, now);

  const chart = useSpendRateChart(windowRows, tw);

  const allRowCount = rows.size;
  // Not-found: rows exist system-wide but none match this id even at the floor-deep window (FR-9).
  const notFound = !session && allRowCount > 0 && sessionRows.length === 0;

  const scopeTitle = `Session ${shortId(sessionId)}`;
  const subtitle = session?.worktree ?? "Single-session token usage";

  // Save star state (FR-1, FR-3, DD-1, DD-2).
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { fetchIsSaved(sessionId).then(setSaved); }, [sessionId]);
  const onToggle = async () => {
    setBusy(true); const next = !saved; setSaved(next);            // optimistic (DD-1)
    const ok = next ? await saveSession(sessionId) : await unsaveSession(sessionId);
    if (!ok) setSaved(!next);                                       // reconcile on failure
    setBusy(false);
  };

  // Agent Inspector wiring (FR-3, FR-4, AD-7).
  const { availableIds } = useSessionAgents(sessionId);
  const [inspectId, setInspectId] = React.useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = React.useState(false);

  // The inspected agent's harvested rows — the single source (R8) the modal's spend cards derive
  // from, so they agree with the session-view row by construction. Main agent's transcriptId is the
  // sessionId (see rowTranscriptId); every other agent is keyed by its own agentId.
  const inspectedAgentRows = React.useMemo(() => {
    if (!inspectId) return [];
    return inspectId === sessionId
      ? windowRows.filter((r) => r.source === 'main-agent')
      : windowRows.filter((r) => r.agentId === inspectId);
  }, [windowRows, inspectId, sessionId]);

  return (
    <>
      <ObservabilitySubHeader
        leading={<BackButton ariaLabel="Back to all sessions" className="-ml-5 -mr-2" />}
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
        onResetRange={hasDefault ? onResetRange : undefined}
        actions={<SaveStarButton saved={saved} busy={busy} onToggle={onToggle} />}
      />
      <main id="main-content" className="px-6 py-[var(--space-4)] space-y-[var(--space-4)]">
        {notFound ? (
          <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-[var(--space-4)] text-sm text-muted-foreground">
            Session not found (or aged out of the retention window).
          </div>
        ) : (
          <>
            <SpendRateChart data={chart.data} series={chart.series} title="Token Spend Rate · This Session" rangeStart={rangeStart} rangeEnd={rangeEnd} ready={ready} />
            {session && <SessionSummaryCards session={windowedSession!} />}
            {session && <TokenBreakdown {...sumRawTokens(windowedSession!.rows)} />}
            {session && (
              <AgentTree
                tree={subagentTree}
                title="Agent Breakdown"
                coverage={coverage}
                ready={ready}
                now={now}
                sessionId={sessionId}
                availableIds={availableIds}
                onInspect={setInspectId}
              />
            )}
          </>
        )}
        {inspectId && (
          <AgentInspectorModal
            sessionId={sessionId}
            agentId={inspectId}
            labels={agentLabels}
            rows={inspectedAgentRows}
            onSelectAgent={setInspectId}
            onClose={() => setInspectId(null)}
            isFullScreen={isFullScreen}
            onToggleFullScreen={() => setIsFullScreen((v) => !v)}
          />
        )}
        <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} title="Session detail" content={SESSION_HELP_MD} />
      </main>
    </>
  );
}
