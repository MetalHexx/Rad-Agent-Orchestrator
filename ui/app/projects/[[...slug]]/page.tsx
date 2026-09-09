"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProjects } from "@/hooks/use-projects";
import { useFollowMode } from "@/hooks/use-follow-mode";
import { useProjectViewMode } from "@/hooks/use-project-view-mode";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert";
import { ProjectSidebar } from "@/components/sidebar";
import { OverviewPage } from "@/components/overview";
import { deleteArtifact } from "@/hooks/use-project-artifacts";
import { useDeleteProject } from "@/hooks/use-delete-project";
import { ConfirmApprovalDialog } from "@/components/dashboard";
import { DAGTimeline, DAGTimelineSkeleton, ProjectHeader, DeleteProjectDialog, HaltReasonBanner, SourceControlPanel, deriveCurrentPhase, derivePhaseProgress } from "@/components/dag-timeline";
import { PlanningSection } from "@/components/planning-section";
import { hasSourceControlRepos, selectSourceControlRepos, selectPrLinks } from "@/components/dag-timeline/source-control-helpers";
import { buildBindLookup } from "@/components/dag-timeline/source-control-bind";
import { useRegistryStore } from "@/components/repo-registry/use-registry-store";
import { SSEStatusBanner } from "@/components/badges";
import { isV5State, isV6State } from "@/types/state";
import type { ProjectStateV5, ProjectStateV6, GraphStatus, GateMode, NodeStatus } from "@/types/state";
import type { SSEConnectionStatus } from "@/types/events";
import type { ProjectSummary, DocumentFrontmatter } from "@/types/components";
import { ArtifactViewerModal } from "@/components/artifacts";
import { useArtifactModal, markdownPathForActive, deleteTargetForActive } from "@/hooks/use-artifact-modal";
import { ArtifactLiveProvider, useArtifactLive } from "@/hooks/use-artifact-live";
import { ApprovalWizardProvider } from "@/hooks/use-approval-wizard";
import { buildModalDocs } from "@/lib/modal-doc-model";
import { selectProjectView, type ProjectView } from "@/lib/project-view";
import { nextHoldState, type HoldState } from "@/lib/hold-floor";

/** Minimum time the state placeholder stays on screen once it appears. */
const PLACEHOLDER_FLOOR_MS = 300;

// ─── Inner component — runs under ArtifactLiveProvider ────────────────────────

interface ProjectsPageContentProps {
  selectedProject: string | null;
  selected: ProjectSummary;
  v5State: ProjectStateV5 | ProjectStateV6 | null;
  /** Decided once by the outer component — this component never re-derives it. */
  view: ProjectView;
  /** Already non-null whenever `view` is 'error'. */
  stateErrorMessage: string | null;
  onRetryState: () => void;
  v5Derivations: {
    graphStatus: GraphStatus | undefined;
    gateMode: GateMode | null | undefined;
    currentPhaseName: string | null;
    progress: { completed: number; total: number } | null;
    compareUrlByRepo: Record<string, string | null>;
    phaseLoopStatus: NodeStatus | undefined;
  };
  followMode: boolean;
  toggleFollowMode: () => void;
  expandedLoopIds: string[];
  onAccordionChange: (value: string[], eventDetails: { reason: string }) => void;
  sseStatus: SSEConnectionStatus;
  reconnect: () => void;
  setPendingDelete: (a: { fileName: string } | null) => void;
  onActivePathChange: (path: string | null) => void;
  registerOnDeleted: (fn: () => void) => void;
  urlDoc: string | null;
  onRequestDelete: () => void;
  viewMode: 'overview' | 'pipeline';
  onViewModeChange: (mode: 'overview' | 'pipeline') => void;
}

function ProjectsPageContent({
  selectedProject,
  selected,
  v5State,
  view,
  stateErrorMessage,
  onRetryState,
  v5Derivations,
  followMode,
  toggleFollowMode,
  expandedLoopIds,
  onAccordionChange,
  sseStatus,
  reconnect,
  setPendingDelete,
  onActivePathChange,
  registerOnDeleted,
  urlDoc,
  onRequestDelete,
  viewMode,
  onViewModeChange,
}: ProjectsPageContentProps) {
  const live = useArtifactLive();
  const artifacts = live.artifacts;
  const requirementsStatus = live.requirementsStatus;

  // The modal's unified, path-identified document list — built from the
  // provider's owner-paired snapshot (live.files), which already carries
  // subfolder paths the root-only live.artifacts can't represent.
  const modalDocs = React.useMemo(
    () => (selectedProject ? buildModalDocs(selectedProject, live.files, v5State, v5State !== null) : []),
    [selectedProject, live.files, v5State],
  );

  // Tracks the latest selectedProject so the modal-doc fetch below can tell,
  // at the point its response resolves, whether it's still current. The
  // closure it was issued under only sees the value at issue time, which
  // can't observe the user leaving this project and returning to it before
  // the response lands.
  const selectedProjectRef = React.useRef<string | null>(selectedProject);
  selectedProjectRef.current = selectedProject;

  const { store: registryStore } = useRegistryStore();
  const bindByName = React.useMemo(() => buildBindLookup(registryStore.repos), [registryStore.repos]);

  const getArtifacts = useCallback(() => modalDocs, [modalDocs]);
  // In-modal doc switching mutates the URL with the History API, NOT the Next router.
  // router.push/replace remounts this page (App Router re-keys the [[...slug]] segment on a
  // param change), which would reset isFullScreen, throw away the BufferedStage cross-fade,
  // and refetch — i.e. the "full page reload" jank. window.history.{push,replace}State updates
  // the address bar without a navigation, so the page only re-renders: fullscreen and the
  // cross-fade survive. usePathname() (read side, outer component) tracks these shallow updates.
  const navigate = useCallback((path: string | null, mode: 'push' | 'replace' | 'back') => {
    if (!selectedProject) return;
    if (mode === 'back') { window.history.back(); return; }
    const base = `/projects/${encodeURIComponent(selectedProject)}`;
    const url = path ? `${base}/docs/${path.split('/').map(encodeURIComponent).join('/')}` : base;
    if (mode === 'replace') window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  }, [selectedProject]);
  const modal = useArtifactModal(getArtifacts, urlDoc, navigate);
  const openArtifactModal = modal.openByName;

  // Bridges a delete to the provider: the outer component's confirm dialog
  // sits outside ArtifactLiveProvider, so it has no way to trigger a refresh
  // itself. Composing modal.onDeleted with live.refresh here — and having the
  // outer component call only this registered handler — gets the delete an
  // immediate snapshot refresh without waiting on the filesystem watcher.
  const onDeleted = React.useCallback(() => { modal.onDeleted(); live.refresh(); }, [modal.onDeleted, live]);
  React.useEffect(() => {
    registerOnDeleted(onDeleted);
  }, [registerOnDeleted, onDeleted]);

  const [isFullScreen, setIsFullScreen] = useState(false);
  const [modalClosing, setModalClosing] = useState(false);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modalMarkdown, setModalMarkdown] = useState<string | null>(null);
  // Which file `modalMarkdown` currently holds the body for. Set when a fetch
  // resolves; null while clearing/loading. Lets the stage withhold a stale body
  // from a freshly-navigated md layer until its own fetch lands (BUG 1).
  const [modalMarkdownFileName, setModalMarkdownFileName] = useState<string | null>(null);
  // Fetched alongside modalMarkdown, from the same /document response — gated
  // by the same modalMarkdownFileName identity so a stale doc's frontmatter
  // never renders against a freshly-navigated body.
  const [modalFrontmatter, setModalFrontmatter] = useState<DocumentFrontmatter | null>(null);
  // Owned here (not in the modal) so it persists across prev/next/select and is
  // reset only when the modal itself closes. Default false: frontmatter starts hidden.
  const [showFrontmatter, setShowFrontmatter] = useState(false);

  // Active path is the modal's own identity — single choke point, no
  // longer derived from a (mutable) array index.
  const activePath = modal.activePath;

  // Clear the unseen badge for whichever file the user is viewing — the one
  // authoritative place this fires so every open route and prev/next clears uniformly.
  React.useEffect(() => {
    live.markActive(activePath);
    onActivePathChange(activePath);
  }, [activePath, live, onActivePathChange]);

  // Frontmatter toggle resets whenever the modal itself closes (regardless of
  // how — close button, deferred-unmount handler, or delete-driven auto-close)
  // so reopening always starts hidden again.
  useEffect(() => { if (!modal.open) { setIsFullScreen(false); setShowFrontmatter(false); } }, [modal.open]);

  // Memoized so its identity is stable across a snapshot refresh that doesn't
  // touch the active doc — `modalDocs` gets a new array identity on every
  // `live.files` change, but `mdPath` only changes when the active doc itself
  // (or its markdown-ness) actually changes.
  const mdPath = React.useMemo(
    () => markdownPathForActive(modalDocs, modal.activePath),
    [modalDocs, modal.activePath],
  );
  // Keys the body-fetch effect to the open doc's own mtime rather than to
  // `modalDocs`/`live.files` directly, so an edit to ANY other file in the
  // project — which gives `live.files` a fresh identity — does not refetch
  // the doc the reader currently has open.
  const activeMtime = modal.activePath ? (live.mtimes[modal.activePath] ?? 0) : 0;

  useEffect(() => {
    if (!modal.open || !mdPath || !selectedProject) {
      setModalMarkdown(null);
      setModalMarkdownFileName(null);
      setModalFrontmatter(null);
      return;
    }
    // Note: we intentionally leave the prior body/owner in place while the new fetch
    // is in flight. The stage gates markdown by path, so the previously-shown
    // (front) doc keeps rendering its own content while the incoming layer waits on
    // its matching fetch — no stale flash, no front spinner during navigation (BUG 1).
    const project = selectedProject;
    // The stale-project guard below (in addition to `cancelled`): a response
    // for a project the user returned to and left again can still land while
    // `cancelled` is false for the run current at issue time, so ownership is
    // re-checked against the live ref at the point of writing, not relying on
    // effect-cleanup ordering alone.
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(project)}/document?path=${encodeURIComponent(mdPath)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch markdown");
        return res.json();
      })
      .then((data: { content: string; frontmatter: DocumentFrontmatter }) => {
        if (cancelled || project !== selectedProjectRef.current) return;
        setModalMarkdown(data.content);
        setModalFrontmatter(data.frontmatter);
        setModalMarkdownFileName(mdPath);
      })
      .catch(() => {
        if (cancelled || project !== selectedProjectRef.current) return;
        setModalMarkdown('');
        setModalFrontmatter({});
        setModalMarkdownFileName(mdPath);
      });
    return () => { cancelled = true; };
  }, [modal.open, mdPath, selectedProject, activeMtime]);

  const handleToggleFrontmatter = useCallback(() => setShowFrontmatter((v) => !v), []);

  const handleModalClose = useCallback(() => {
    setModalClosing(true);
    closeTimerRef.current = setTimeout(() => {
      modal.close();
      setModalClosing(false);
    }, 200);
  }, [modal]);

  React.useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  // A pipeline-less project has no Pipeline view to toggle to, so visiting one
  // pins the operator's global Overview/Pipeline preference to Overview — a
  // later switch to a project that DOES have a pipeline then starts there
  // instead of carrying over a stale Pipeline choice from before.
  useEffect(() => {
    if (view === 'launch' && viewMode !== 'overview') onViewModeChange('overview');
  }, [view, viewMode, onViewModeChange]);

  // `view` is the only thing consulted here — the ownership comparisons that
  // decided it live in selectProjectView, so no local condition can second-guess
  // them and let one project's state render under another's name.
  function renderView() {
    switch (view) {
      case 'loading':
        return (
          <div className="overflow-auto">
            <ProjectHeader
              projectName={selected.name}
              state={selected.state}
              stateLabel={selected.stateLabel}
              followMode={false}
              onToggleFollowMode={() => {}}
              projectType={selected.project_type}
              onRequestDelete={onRequestDelete}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
            />
            <div className="flex flex-col">
              <HaltReasonBanner
                graphStatus={v5Derivations.graphStatus}
                haltReason={null}
              />
              <SSEStatusBanner
                status={sseStatus}
                degraded={live.degraded}
                onReconnect={reconnect}
              />
            </div>
            <div className="px-6 py-4" role="status" aria-label="Loading project state">
              <DAGTimelineSkeleton />
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="overflow-auto">
            <ProjectHeader
              projectName={selected.name}
              state={selected.state}
              stateLabel={selected.stateLabel}
              followMode={false}
              onToggleFollowMode={() => {}}
              projectType={selected.project_type}
              onRequestDelete={onRequestDelete}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
            />
            <div className="flex flex-col">
              <SSEStatusBanner
                status={sseStatus}
                degraded={live.degraded}
                onReconnect={reconnect}
              />
            </div>
            <div className="px-6 py-4">
              <Alert variant="destructive">
                <AlertTitle>Couldn&rsquo;t load this project&rsquo;s state</AlertTitle>
                <AlertDescription>{stateErrorMessage}</AlertDescription>
                <AlertAction>
                  <button
                    type="button"
                    onClick={onRetryState}
                    className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    Retry
                  </button>
                </AlertAction>
              </Alert>
            </div>
          </div>
        );

      // The null check is a type narrowing, not a view decision: it can only
      // withhold the plan, never route around `view`.
      case 'plan':
        return v5State === null ? null : (
          <div className="overflow-auto">
            <ProjectHeader
              projectName={selected.name}
              state={selected.state}
              stateLabel={selected.stateLabel}
              graphStatus={v5Derivations.graphStatus}
              gateMode={v5Derivations.gateMode}
              currentPhaseName={v5Derivations.currentPhaseName}
              progress={v5Derivations.progress}
              followMode={followMode}
              onToggleFollowMode={toggleFollowMode}
              projectType={selected.project_type}
              onRequestDelete={onRequestDelete}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
            />
            <div className="flex flex-col">
              <HaltReasonBanner
                graphStatus={v5Derivations.graphStatus}
                haltReason={v5State.pipeline.halt_reason}
              />
              <SSEStatusBanner
                status={sseStatus}
                degraded={live.degraded}
                onReconnect={reconnect}
              />
            </div>
            <div className="px-6 py-4 flex flex-col gap-3">
              {!live.snapshotLoaded ? (
                <DAGTimelineSkeleton />
              ) : viewMode === 'overview' ? (
                <OverviewPage
                  projectName={selected.name}
                  onOpenArtifact={(index) => openArtifactModal(artifacts[index].fileName)}
                  onDeleteArtifact={(a) => setPendingDelete(a)}
                />
              ) : (
                <>
                  <PlanningSection
                    artifacts={artifacts}
                    requirementsStatus={requirementsStatus}
                    onOpen={(index) => openArtifactModal(artifacts[index].fileName)}
                    onDelete={(a) => setPendingDelete(a)}
                    unseen={live.unseen}
                    activePulse={live.activePulse}
                    state={v5State}
                    onDocClick={openArtifactModal}
                    compareUrlByRepo={v5Derivations.compareUrlByRepo}
                    projectName={selected.name}
                  />
                  <DAGTimeline
                    nodes={v5State.graph.nodes}
                    state={v5State}
                    currentNodePath={v5State.graph.current_node_path}
                    onDocClick={openArtifactModal}
                    expandedLoopIds={expandedLoopIds}
                    onAccordionChange={onAccordionChange}
                    compareUrlByRepo={v5Derivations.compareUrlByRepo}
                    projectName={selected.name}
                    phaseLoopStatus={v5Derivations.phaseLoopStatus}
                    prLinks={selectPrLinks(v5State.pipeline.source_control)}
                    afterPlanningSlot={
                      hasSourceControlRepos(v5State.pipeline.source_control) && (
                        <SourceControlPanel
                          repos={v5State.pipeline.source_control!.repos}
                          projectName={selected.name}
                          projectType={selected.project_type}
                          autoCommit={v5State.pipeline.source_control!.auto_commit}
                          autoPr={v5State.pipeline.source_control!.auto_pr}
                          bindByName={bindByName}
                        />
                      )
                    }
                  />
                </>
              )}
            </div>
          </div>
        );

      // Always the Overview — a pipeline-less project has no DAG to toggle to,
      // so unlike 'plan' this branch never consults `viewMode`.
      case 'launch':
        return (
          <div className="overflow-auto">
            <ProjectHeader
              projectName={selected.name}
              state={selected.state}
              stateLabel={selected.stateLabel}
              followMode={false}
              onToggleFollowMode={() => {}}
              projectType={selected.project_type}
              onRequestDelete={onRequestDelete}
              viewMode={undefined}
              onViewModeChange={onViewModeChange}
            />
            <div className="flex flex-col">
              <SSEStatusBanner
                status={sseStatus}
                degraded={live.degraded}
                onReconnect={reconnect}
              />
            </div>
            <div className="px-6 py-4 flex flex-col gap-3">
              <OverviewPage
                projectName={selected.name}
                onOpenArtifact={(index) => openArtifactModal(artifacts[index].fileName)}
                onDeleteArtifact={(a) => setPendingDelete(a)}
              />
            </div>
          </div>
        );
    }
  }

  return (
    <>
      {renderView()}

      {modal.open && modalDocs.some((d) => d.path === modal.activePath) && (
        <ArtifactViewerModal
          projectName={selectedProject!}
          artifacts={modalDocs}
          activePath={modal.activePath}
          markdownContent={modalMarkdown}
          markdownContentFileName={modalMarkdownFileName}
          frontmatter={modalFrontmatter}
          showFrontmatter={showFrontmatter}
          onToggleFrontmatter={handleToggleFrontmatter}
          onClose={handleModalClose}
          dataState={modalClosing ? "closed" : "open"}
          onPrev={modal.goPrev}
          onNext={modal.goNext}
          onSelect={(path) => modal.openByName(path)}
          onRequestDelete={() => { const d = deleteTargetForActive(modalDocs, modal.activePath); if (d) setPendingDelete(d); }}
          isFullScreen={isFullScreen}
          onToggleFullScreen={() => setIsFullScreen((v) => !v)}
          unseen={live.unseen}
          activePulse={live.activePulse}
          mtimes={live.mtimes}
        />
      )}

      {modal.open && live.snapshotLoaded && !modalDocs.some((d) => d.path === modal.activePath) && (
        <div role="alert" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-card p-6 text-card-foreground shadow-lg">
            <p className="text-sm text-muted-foreground">Document not found.</p>
            <button type="button" onClick={() => navigate(null, 'replace')}
              className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Outer component — mounts ArtifactLiveProvider ───────────────────────────

export default function ProjectsPage() {
  const pathname = usePathname();
  // Read the route from usePathname() (not useParams()) because in-modal navigation now
  // mutates the URL with window.history.{push,replace}State — a shallow update that Next 14.1+
  // reflects in usePathname() but NOT in useParams(). usePathname() returns the ENCODED path,
  // so decode each segment exactly once (the write side encodes once — see `navigate`). A guard
  // keeps a malformed '%' from throwing URIError; it falls through to the not-found state.
  const segs = pathname.split('/').filter(Boolean); // ["projects", <project?>, "docs", ...<doc path segments>]
  const decodeSeg = (s: string | undefined): string | null => {
    if (s === undefined) return null;
    try { return decodeURIComponent(s); } catch { return s; }
  };
  const urlProject = segs.length >= 2 ? decodeSeg(segs[1]) : null;
  // Everything after `docs/` is the doc's path segments — a flat filename is
  // one segment (byte-identical to before); a nested path (`phases/…`) is
  // several. Reconstruct the full relative path from ALL of them, not just
  // the first, so a nested path round-trips instead of silently resolving to
  // the wrong (or no) document.
  const urlDoc = segs[2] === 'docs' && segs.length > 3
    ? segs.slice(3).map((s) => decodeSeg(s) ?? s).join('/')
    : null;
  const router = useRouter();

  const {
    projects,
    selectedProject,
    projectState,
    selectProject,
    isLoading,
    error,
    stateSettledFor,
    sseStatus,
    reconnect,
  } = useProjects(urlProject);

  const [notFoundName, setNotFoundName] = useState<string | null>(null);

  useEffect(() => {
    if (urlProject && urlProject !== selectedProject && projects.some((p) => p.name === urlProject)) {
      selectProject(urlProject);
    }
  }, [urlProject, selectedProject, projects, selectProject]);

  useEffect(() => {
    if (!urlProject) { setNotFoundName(null); return; }
    if (!isLoading && projects.length > 0 && !projects.some((p) => p.name === urlProject)) {
      setNotFoundName(urlProject);
      router.replace('/projects');
    }
  }, [urlProject, isLoading, projects, router]);

  // The single ownership gate for state: everything derived below inherits it
  // (including the v5State handed down to ProjectsPageContent's buildModalDocs
  // call), so v5Derivations, useFollowMode, and the modal's doc list can never
  // see state that was fetched for a different project.
  const usableState = projectState && projectState.owner === selectedProject ? projectState.state : null;

  const v6State: ProjectStateV6 | null =
    usableState && isV6State(usableState) ? usableState : null;

  const v5State: ProjectStateV5 | ProjectStateV6 | null =
    usableState && isV5State(usableState) ? usableState : v6State;

  const nodesForFollowMode = v5State ? v5State.graph.nodes : null;
  const { followMode, expandedLoopIds, onAccordionChange, toggleFollowMode } = useFollowMode(nodesForFollowMode, selectedProject);
  const { mode: viewMode, setMode: setViewMode } = useProjectViewMode();

  const selected: ProjectSummary | undefined = useMemo(
    () => projects.find((p) => p.name === selectedProject),
    [projects, selectedProject],
  );

  const [pendingDelete, setPendingDelete] = useState<{ fileName: string } | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const handleModalDeletedRef = React.useRef<() => void>(() => {});
  const registerOnDeleted = useCallback((fn: () => void) => { handleModalDeletedRef.current = fn; }, []);

  // Project-level delete (header trash control). The hook is instantiated
  // unconditionally per the rules of hooks; it does nothing until the
  // dialog's handlers below actually call loadPlan/confirm, both of which
  // only fire once a project is selected.
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const { plan: deletePlan, planError: deletePlanError, report: deleteReport, isPending: deleteProjectPending, loadPlan: loadDeletePlan, confirm: confirmDeleteProject, reset: resetDeleteProject } = useDeleteProject(selectedProject ?? "");
  const handleRequestDeleteProject = useCallback(() => {
    setDeleteProjectOpen(true);
    void loadDeletePlan();
  }, [loadDeletePlan]);
  const handleDeleteProjectOpenChange = useCallback((o: boolean) => {
    setDeleteProjectOpen(o);
    if (!o) resetDeleteProject();
  }, [resetDeleteProject]);
  const handleConfirmDeleteProject = useCallback(async (skip: NonNullable<Parameters<typeof confirmDeleteProject>[0]>) => {
    const complete = await confirmDeleteProject(skip);
    if (complete) {
      setDeleteProjectOpen(false);
      resetDeleteProject();
      router.replace('/projects');
    }
  }, [confirmDeleteProject, resetDeleteProject, router]);

  const v5Derivations = useMemo(() => {
    if (!v5State) {
      return { graphStatus: undefined, gateMode: undefined, currentPhaseName: null, progress: null, compareUrlByRepo: {}, phaseLoopStatus: undefined };
    }
    const phaseLoopNode = v5State.graph.nodes.phase_loop;
    const typedPhaseLoop = phaseLoopNode?.kind === 'for_each_phase' ? phaseLoopNode : undefined;
    const sourceControlRepos = selectSourceControlRepos(v5State.pipeline.source_control ?? null);
    return {
      graphStatus: v5State.graph.status,
      gateMode: v5State.pipeline.gate_mode,
      currentPhaseName: deriveCurrentPhase(typedPhaseLoop),
      progress: derivePhaseProgress(typedPhaseLoop),
      compareUrlByRepo: Object.fromEntries(
        sourceControlRepos.map((r): [string, string | null] => [r.name, r.compare_url])
      ),
      phaseLoopStatus: typedPhaseLoop?.status,
    };
  }, [v5State]);

  // Active path for the provider — derived from modal state inside the
  // inner component and surfaced here via state so the provider prop stays live.
  const [activePath, setActivePath] = useState<string | null>(null);

  // Minimum-visible floor for the state placeholder. Without it a fast fetch
  // flashes the skeleton for a couple of frames on every project switch; the
  // floor never outlasts a slower fetch, which resolves the condition itself.
  const placeholderActive = selectedProject !== null && stateSettledFor !== selectedProject;
  const holdRef = React.useRef<HoldState>({ shownAt: null });
  const holdTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [placeholderHeld, setPlaceholderHeld] = useState(false);
  const [holdWake, setHoldWake] = useState(0);

  useEffect(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    const { held, state, wakeInMs } = nextHoldState(
      holdRef.current, placeholderActive, Date.now(), PLACEHOLDER_FLOOR_MS,
    );
    holdRef.current = state;
    setPlaceholderHeld(held);
    if (wakeInMs !== null) {
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        setHoldWake((n) => n + 1);
      }, wakeInMs);
    }
  }, [placeholderActive, holdWake]);

  useEffect(() => () => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current); }, []);

  // Resolved here because the malformed-state and unreadable-state paths reach
  // the error view with no owned error to read a message off.
  const ownedErrorMessage = error && error.owner === selectedProject ? error.message : null;
  const stateErrorMessage =
    ownedErrorMessage ?? selected?.errorMessage ?? 'This project’s state could not be read.';

  const view: ProjectView = selected
    ? selectProjectView({
        selectedName: selected.name,
        tier: selected.tier,
        schemaVersion: selected.schemaVersion,
        projectType: selected.project_type,
        hasMalformedState: selected.hasMalformedState,
        ownedState: projectState,
        ownedError: error,
        stateSettledFor,
        placeholderHeld,
      })
    : 'loading';

  // `pathname` already names the selected project, so this re-runs the state
  // fetch without a history push — the whole retry path, no extra plumbing.
  const handleRetryState = useCallback(() => {
    if (selected) selectProject(selected.name);
  }, [selected, selectProject]);

  return (
    // ApprovalWizardProvider sits outside every live-state-driven subtree on
    // purpose: approving a final review completes the graph, which swaps the
    // dag-widget card from `finalReviewView` to `completeView` and unmounts the
    // Approve button that started it. The wizard must outlive that.
    <ApprovalWizardProvider>
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      <SidebarProvider className="min-h-0 flex-1">
        <ProjectSidebar
          projects={projects}
          selectedProject={selectedProject}
          onSelectProject={selectProject}
          isLoading={isLoading}
        />

        <SidebarInset id="main-content">
          {isLoading && !selected ? (
            <div className="flex h-full items-center justify-center" role="status" aria-label="Loading projects">
              <div className="text-center">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
                <p className="text-sm text-muted-foreground">
                  Loading projects…
                </p>
              </div>
            </div>
          ) : error && error.owner === null && !selected ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-md text-center">
                <p className="text-sm text-destructive" role="alert">{error.message}</p>
              </div>
            </div>
          ) : notFoundName && !selected ? (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-sm text-muted-foreground" role="alert">
                Project &ldquo;{notFoundName}&rdquo; was not found.
              </p>
            </div>
          ) : selected ? (
            <ArtifactLiveProvider projectName={selectedProject} activeFileName={activePath} hasTimeline={v5State !== null}>
              <ProjectsPageContent
                selectedProject={selectedProject}
                selected={selected}
                v5State={v5State}
                view={view}
                stateErrorMessage={stateErrorMessage}
                onRetryState={handleRetryState}
                v5Derivations={v5Derivations}
                followMode={followMode}
                toggleFollowMode={toggleFollowMode}
                expandedLoopIds={expandedLoopIds}
                onAccordionChange={onAccordionChange}
                sseStatus={sseStatus}
                reconnect={reconnect}
                setPendingDelete={setPendingDelete}
                onActivePathChange={setActivePath}
                registerOnDeleted={registerOnDeleted}
                urlDoc={urlDoc}
                onRequestDelete={handleRequestDeleteProject}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
              />
            </ArtifactLiveProvider>
          ) : (
            <div className="flex h-full flex-col">
              <SSEStatusBanner
                status={sseStatus}
                degraded={false}
                onReconnect={reconnect}
              />
              <div className="flex flex-1 items-center justify-center p-6">
                <p className="text-sm text-muted-foreground">
                  Select a project to begin
                </p>
              </div>
            </div>
          )}
        </SidebarInset>
      </SidebarProvider>

      <ConfirmApprovalDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) { setPendingDelete(null); setDeleteError(null); } }}
        title="Delete Artifact"
        documentName={pendingDelete?.fileName ?? ''}
        description="This will permanently remove"
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        isPending={deletePending}
        errorMessage={deleteError}
        onConfirm={async () => {
          if (!pendingDelete || !selectedProject) return;
          setDeleteError(null);
          setDeletePending(true);
          const ok = await deleteArtifact(selectedProject, pendingDelete.fileName);
          setDeletePending(false);
          if (ok) {
            setPendingDelete(null);
            handleModalDeletedRef.current();
          } else {
            setDeleteError(`Failed to delete ${pendingDelete.fileName}. Please try again.`);
          }
        }}
      />

      <DeleteProjectDialog
        open={deleteProjectOpen}
        onOpenChange={handleDeleteProjectOpenChange}
        projectName={selectedProject ?? ''}
        plan={deletePlan}
        planError={deletePlanError}
        report={deleteReport}
        isPending={deleteProjectPending}
        onConfirm={handleConfirmDeleteProject}
        projectType={selected?.project_type}
      />
    </div>
    </ApprovalWizardProvider>
  );
}
