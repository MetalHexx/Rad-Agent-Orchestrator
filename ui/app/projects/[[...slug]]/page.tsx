"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProjects } from "@/hooks/use-projects";
import { useDocumentDrawer } from "@/hooks/use-document-drawer";
import { useFollowMode } from "@/hooks/use-follow-mode";
import { useConfigEditor } from "@/hooks/use-config-editor";
import { useConfigClickContext } from "@/hooks/use-config-click-context";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { ProjectSidebar } from "@/components/sidebar";
import { LaunchScreen } from "@/components/layout";
import { useStartAction } from "@/hooks/use-start-action";
import { deleteArtifact } from "@/hooks/use-project-artifacts";
import { DocumentDrawer } from "@/components/documents";
import { ConfirmApprovalDialog } from "@/components/dashboard";
import { ConfigEditorPanel } from "@/components/config";
import { DAGTimeline, DAGTimelineSkeleton, ProjectHeader, HaltReasonBanner, BrainstormingSection, SourceControlPanel, deriveCurrentPhase, derivePhaseProgress, deriveRepoBaseUrl } from "@/components/dag-timeline";
import { hasSourceControlRepos } from "@/components/dag-timeline/source-control-helpers";
import { buildBindLookup } from "@/components/dag-timeline/source-control-bind";
import { useRegistryStore } from "@/components/repo-registry/use-registry-store";
import { SSEStatusBanner } from "@/components/badges";
import { getOrderedDocsV5 } from "@/lib/document-ordering";
import { isV5State, isV6State } from "@/types/state";
import type { ProjectStateV5, ProjectStateV6, GraphStatus, GateMode, NodeStatus } from "@/types/state";
import type { SSEConnectionStatus } from "@/types/events";
import type { ProjectSummary } from "@/types/components";
import { ArtifactViewerModal } from "@/components/artifacts";
import { useArtifactModal, markdownPathForActive } from "@/hooks/use-artifact-modal";
import { ArtifactLiveProvider, useArtifactLive } from "@/hooks/use-artifact-live";

// ─── Inner component — runs under ArtifactLiveProvider ────────────────────────

interface ProjectsPageContentProps {
  selectedProject: string | null;
  selected: ProjectSummary | undefined;
  v5State: ProjectStateV5 | ProjectStateV6 | null;
  v5Derivations: {
    graphStatus: GraphStatus | undefined;
    gateMode: GateMode | null | undefined;
    currentPhaseName: string | null;
    progress: { completed: number; total: number } | null;
    repoBaseUrl: string | null;
    phaseLoopStatus: NodeStatus | undefined;
  };
  followMode: boolean;
  toggleFollowMode: () => void;
  expandedLoopIds: string[];
  onAccordionChange: (value: string[], eventDetails: { reason: string }) => void;
  sseStatus: SSEConnectionStatus;
  reconnect: () => void;
  openDocument: (path: string) => void;
  filesLoaded: boolean;
  setPendingDelete: (a: import("@/lib/artifact-model").Artifact | null) => void;
  onActiveFileNameChange: (fileName: string | null) => void;
  registerOnDeleted: (fn: () => void) => void;
  urlDoc: string | null;
}

function ProjectsPageContent({
  selectedProject,
  selected,
  v5State,
  v5Derivations,
  followMode,
  toggleFollowMode,
  expandedLoopIds,
  onAccordionChange,
  sseStatus,
  reconnect,
  openDocument,
  filesLoaded,
  setPendingDelete,
  onActiveFileNameChange,
  registerOnDeleted,
  urlDoc,
}: ProjectsPageContentProps) {
  const live = useArtifactLive();
  const artifacts = live.artifacts;

  const { store: registryStore } = useRegistryStore();
  const bindByName = React.useMemo(() => buildBindLookup(registryStore.repos), [registryStore.repos]);

  const getArtifacts = useCallback(() => artifacts, [artifacts]);
  // In-modal doc switching mutates the URL with the History API, NOT the Next router.
  // router.push/replace remounts this page (App Router re-keys the [[...slug]] segment on a
  // param change), which would reset isFullScreen, throw away the BufferedStage cross-fade,
  // and refetch — i.e. the "full page reload" jank. window.history.{push,replace}State updates
  // the address bar without a navigation, so the page only re-renders: fullscreen and the
  // cross-fade survive. usePathname() (read side, outer component) tracks these shallow updates.
  const navigate = useCallback((fileName: string | null, mode: 'push' | 'replace' | 'back') => {
    if (!selectedProject) return;
    if (mode === 'back') { window.history.back(); return; }
    const base = `/projects/${encodeURIComponent(selectedProject)}`;
    const url = fileName ? `${base}/docs/${encodeURIComponent(fileName)}` : base;
    if (mode === 'replace') window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  }, [selectedProject]);
  const modal = useArtifactModal(getArtifacts, urlDoc, navigate);
  const openArtifactModal = modal.openByName;

  React.useEffect(() => {
    registerOnDeleted(modal.onDeleted);
  }, [registerOnDeleted, modal.onDeleted]);

  const [isFullScreen, setIsFullScreen] = useState(false);
  const [modalClosing, setModalClosing] = useState(false);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modalMarkdown, setModalMarkdown] = useState<string | null>(null);
  // Which file `modalMarkdown` currently holds the body for. Set when a fetch
  // resolves; null while clearing/loading. Lets the stage withhold a stale body
  // from a freshly-navigated md layer until its own fetch lands (BUG 1).
  const [modalMarkdownFileName, setModalMarkdownFileName] = useState<string | null>(null);

  // Active file name is the modal's own identity — single choke point, no
  // longer derived from a (mutable) array index.
  const activeFileName = modal.activeFileName;

  // Clear the unseen badge for whichever file the user is viewing — the one
  // authoritative place this fires so every open route and prev/next clears uniformly.
  React.useEffect(() => {
    live.markActive(activeFileName);
    onActiveFileNameChange(activeFileName);
  }, [activeFileName, live, onActiveFileNameChange]);

  useEffect(() => { if (!modal.open) setIsFullScreen(false); }, [modal.open]);

  useEffect(() => {
    const mdPath = markdownPathForActive(artifacts, modal.activeFileName);
    if (!modal.open || !mdPath || !selectedProject) {
      setModalMarkdown(null);
      setModalMarkdownFileName(null);
      return;
    }
    // Note: we intentionally leave the prior body/owner in place while the new fetch
    // is in flight. The stage gates markdown by fileName, so the previously-shown
    // (front) doc keeps rendering its own content while the incoming layer waits on
    // its matching fetch — no stale flash, no front spinner during navigation (BUG 1).
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(selectedProject)}/document?path=${encodeURIComponent(mdPath)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch markdown");
        return res.json();
      })
      .then((data: { content: string }) => {
        if (!cancelled) { setModalMarkdown(data.content); setModalMarkdownFileName(mdPath); }
      })
      .catch(() => {
        if (!cancelled) { setModalMarkdown(''); setModalMarkdownFileName(mdPath); }
      });
    return () => { cancelled = true; };
  }, [modal.open, modal.activeFileName, artifacts, selectedProject]);

  const handleModalClose = useCallback(() => {
    setModalClosing(true);
    closeTimerRef.current = setTimeout(() => {
      modal.close();
      setModalClosing(false);
    }, 200);
  }, [modal]);

  React.useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  const startAction = useStartAction(selectedProject);

  return (
    <>
      {selected && (selected.schemaVersion === 'v5' || selected.schemaVersion === 'v6') && !v5State ? (
        <div className="overflow-auto">
          <ProjectHeader
            projectName={selected.name}
            tier={selected.tier}
            planningStatus={selected.planningStatus}
            executionStatus={selected.executionStatus}
            sourceControl={null}
            followMode={false}
            onToggleFollowMode={() => {}}
            projectType={selected.project_type}
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
          <div className="px-6 py-4">
            <DAGTimelineSkeleton />
          </div>
        </div>
      ) : selected && v5State ? (
        <div className="overflow-auto">
          <ProjectHeader
            projectName={selected.name}
            tier={selected.tier}
            planningStatus={selected.planningStatus}
            executionStatus={selected.executionStatus}
            graphStatus={v5Derivations.graphStatus}
            gateMode={v5Derivations.gateMode}
            currentPhaseName={v5Derivations.currentPhaseName}
            progress={v5Derivations.progress}
            sourceControl={v5State.pipeline.source_control}
            followMode={followMode}
            onToggleFollowMode={toggleFollowMode}
            projectType={selected.project_type}
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
            {filesLoaded ? (
              <>
                <BrainstormingSection
                  artifacts={artifacts}
                  onOpen={(index) => openArtifactModal(artifacts[index].fileName)}
                  onDelete={(a) => setPendingDelete(a)}
                  unseen={live.unseen}
                  activePulse={live.activePulse}
                />
                {hasSourceControlRepos(v5State.pipeline.source_control) && (
                  <SourceControlPanel
                    repos={v5State.pipeline.source_control!.repos!}
                    projectName={selected.name}
                    projectType={selected.project_type}
                    autoCommit={v5State.pipeline.source_control!.auto_commit}
                    autoPr={v5State.pipeline.source_control!.auto_pr}
                    bindByName={bindByName}
                  />
                )}
                <DAGTimeline
                  nodes={v5State.graph.nodes}
                  currentNodePath={v5State.graph.current_node_path}
                  onDocClick={openDocument}
                  expandedLoopIds={expandedLoopIds}
                  onAccordionChange={onAccordionChange}
                  repoBaseUrl={v5Derivations.repoBaseUrl}
                  projectName={selected.name}
                  phaseLoopStatus={v5Derivations.phaseLoopStatus}
                  prUrl={v5State.pipeline.source_control?.repos?.[0]?.pr_url ?? null}
                />
              </>
            ) : (
              <DAGTimelineSkeleton />
            )}
          </div>
        </div>
      ) : selected && selected.tier === 'not_initialized' && !v5State && !selected.hasMalformedState ? (
        <LaunchScreen
          projectName={selected.name}
          artifacts={artifacts}
          onOpenArtifact={(index) => openArtifactModal(artifacts[index].fileName)}
          onDeleteArtifact={(a) => setPendingDelete(a)}
          onStartPlanning={() => startAction.start('start-planning')}
          onStartBrainstorming={() => startAction.start('start-brainstorming')}
          pendingAction={startAction.pendingAction}
          errorMessage={startAction.errorMessage}
          unseen={live.unseen}
          activePulse={live.activePulse}
        />
      ) : null}

      {modal.open && artifacts.some((a) => a.fileName === modal.activeFileName) && (
        <ArtifactViewerModal
          projectName={selectedProject!}
          artifacts={artifacts}
          activeFileName={modal.activeFileName}
          markdownContent={modalMarkdown}
          markdownContentFileName={modalMarkdownFileName}
          onClose={handleModalClose}
          dataState={modalClosing ? "closed" : "open"}
          onPrev={modal.goPrev}
          onNext={modal.goNext}
          onSelect={(fileName) => modal.openByName(fileName)}
          onRequestDelete={() => { const a = artifacts.find((x) => x.fileName === modal.activeFileName); if (a) setPendingDelete(a); }}
          isFullScreen={isFullScreen}
          onToggleFullScreen={() => setIsFullScreen((v) => !v)}
          unseen={live.unseen}
          activePulse={live.activePulse}
          mtimes={live.mtimes}
        />
      )}

      {modal.open && filesLoaded && !artifacts.some((a) => a.fileName === modal.activeFileName) && (
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
  const segs = pathname.split('/').filter(Boolean); // ["projects", <project?>, "docs", <doc?>]
  const decodeSeg = (s: string | undefined): string | null => {
    if (s === undefined) return null;
    try { return decodeURIComponent(s); } catch { return s; }
  };
  const urlProject = segs.length >= 2 ? decodeSeg(segs[1]) : null;
  const urlDoc = segs.length >= 4 && segs[2] === 'docs' ? decodeSeg(segs[3]) : null;
  const router = useRouter();

  const {
    projects,
    selectedProject,
    projectState,
    selectProject,
    isLoading,
    error,
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

  const {
    isOpen,
    docPath,
    loading: docLoading,
    error: docError,
    data: docData,
    openDocument,
    close: closeDocument,
    navigateTo,
    scrollAreaRef,
  } = useDocumentDrawer({ projectName: selectedProject });

  const [fileList, setFileList] = useState<string[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);

  const v6State: ProjectStateV6 | null =
    projectState && isV6State(projectState) ? projectState : null;

  const v5State: ProjectStateV5 | ProjectStateV6 | null =
    projectState && isV5State(projectState) ? projectState : v6State;

  const nodesForFollowMode = v5State ? v5State.graph.nodes : null;
  const { followMode, expandedLoopIds, onAccordionChange, toggleFollowMode } = useFollowMode(nodesForFollowMode, selectedProject);

  const configEditor = useConfigEditor();
  const { setOnConfigClick } = useConfigClickContext();

  useEffect(() => {
    setOnConfigClick(configEditor.open);
    return () => { setOnConfigClick(undefined); };
  }, [setOnConfigClick, configEditor.open]);

  const selected: ProjectSummary | undefined = useMemo(
    () => projects.find((p) => p.name === selectedProject),
    [projects, selectedProject],
  );

  const [pendingDelete, setPendingDelete] = useState<import("@/lib/artifact-model").Artifact | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [fileRefetch, setFileRefetch] = useState(0);
  const handleModalDeletedRef = React.useRef<() => void>(() => {});
  const registerOnDeleted = useCallback((fn: () => void) => { handleModalDeletedRef.current = fn; }, []);

  const v5Derivations = useMemo(() => {
    if (!v5State) {
      return { graphStatus: undefined, gateMode: undefined, currentPhaseName: null, progress: null, repoBaseUrl: null, phaseLoopStatus: undefined };
    }
    const phaseLoopNode = v5State.graph.nodes.phase_loop;
    const typedPhaseLoop = phaseLoopNode?.kind === 'for_each_phase' ? phaseLoopNode : undefined;
    return {
      graphStatus: v5State.graph.status,
      gateMode: v5State.pipeline.gate_mode,
      currentPhaseName: deriveCurrentPhase(typedPhaseLoop),
      progress: derivePhaseProgress(typedPhaseLoop),
      repoBaseUrl: deriveRepoBaseUrl(v5State.pipeline.source_control?.repos?.[0]?.compare_url ?? null),
      phaseLoopStatus: typedPhaseLoop?.status,
    };
  }, [v5State]);

  const orderedDocs = useMemo(() => {
    if (v5State && selectedProject) {
      return getOrderedDocsV5(v5State, selectedProject, fileList);
    }
    return [];
  }, [v5State, selectedProject, fileList]);

  // Reset the files-loaded gate on project change ONLY (not on fileRefetch),
  // so deleting an artifact — which bumps fileRefetch — doesn't flash the
  // timeline body back to a skeleton.
  useEffect(() => { setFilesLoaded(false); }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setFileList([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(selectedProject)}/files`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch files");
        return res.json();
      })
      .then((data: { files: string[]; mtimes?: Record<string, number> }) => {
        if (!cancelled) {
          setFileList(data.files);
          setFilesLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFileList([]);
          // Mark loaded even on failure so the DAG still reveals (brainstorming
          // just stays empty) rather than hanging on the skeleton forever.
          setFilesLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, [selectedProject, fileRefetch]);

  // Active file name for the provider — derived from modal state inside the
  // inner component and surfaced here via state so the provider prop stays live.
  const [activeFileName, setActiveFileName] = useState<string | null>(null);

  return (
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
          ) : error && !selected ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-md text-center">
                <p className="text-sm text-destructive" role="alert">{error}</p>
              </div>
            </div>
          ) : notFoundName && !selected ? (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-sm text-muted-foreground" role="alert">
                Project &ldquo;{notFoundName}&rdquo; was not found.
              </p>
            </div>
          ) : selected ? (
            <ArtifactLiveProvider projectName={selectedProject} activeFileName={activeFileName}>
              <ProjectsPageContent
                selectedProject={selectedProject}
                selected={selected}
                v5State={v5State}
                v5Derivations={v5Derivations}
                followMode={followMode}
                toggleFollowMode={toggleFollowMode}
                expandedLoopIds={expandedLoopIds}
                onAccordionChange={onAccordionChange}
                sseStatus={sseStatus}
                reconnect={reconnect}
                openDocument={openDocument}
                filesLoaded={filesLoaded}
                setPendingDelete={setPendingDelete}
                onActiveFileNameChange={setActiveFileName}
                registerOnDeleted={registerOnDeleted}
                urlDoc={urlDoc}
              />
            </ArtifactLiveProvider>
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-sm text-muted-foreground">
                Select a project to begin
              </p>
            </div>
          )}
        </SidebarInset>
      </SidebarProvider>

      <DocumentDrawer
        open={isOpen}
        docPath={docPath}
        loading={docLoading}
        error={docError}
        data={docData}
        onClose={closeDocument}
        scrollAreaRef={scrollAreaRef}
        docs={orderedDocs}
        onNavigate={navigateTo}
      />

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
            setFileRefetch((n) => n + 1);
          } else {
            setDeleteError(`Failed to delete ${pendingDelete.fileName}. Please try again.`);
          }
        }}
      />

      <ConfigEditorPanel editor={configEditor} />
    </div>
  );
}
