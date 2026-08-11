"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import type { ProjectSummary } from "@/types/components";
import type { AnyProjectState } from "@/types/state";
import { isV6State } from "@/types/state";
import type { SSEEvent, SSEConnectionStatus } from "@/types/events";
import { derivePlanningStatus, deriveExecutionStatus } from "@/lib/status-derivation";
import type { OwnedProjectState, OwnedError } from "@/lib/project-view";
import { useSSEContext } from "@/hooks/use-sse-context";

const STORAGE_KEY = "monitoring-ui-selected-project";

interface UseProjectsReturn {
  /** List of all discovered projects */
  projects: ProjectSummary[];
  /** Name of the currently selected project, or null */
  selectedProject: string | null;
  /** State for the selected project, tagged with the project it was fetched for */
  projectState: OwnedProjectState | null;
  /** Function to select a project by name */
  selectProject: (name: string) => void;
  /** True while any fetch is in progress */
  isLoading: boolean;
  /** Failure message tagged with its project, or null owner for a project-list failure */
  error: OwnedError | null;
  /** The project whose state fetch has resolved — ok, 404, or failure alike */
  stateSettledFor: string | null;
  /** SSE connection status from the shared SSE provider */
  sseStatus: SSEConnectionStatus;
  /** Manual reconnect function — tears down and re-creates the shared EventSource */
  reconnect: () => void;
}

export function useProjects(initialProject?: string | null): UseProjectsReturn {
  const pathname = usePathname();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projectState, setProjectState] =
    useState<OwnedProjectState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<OwnedError | null>(null);
  const [stateSettledFor, setStateSettledFor] = useState<string | null>(null);

  // Stable ref for selectedProject to use inside the SSE callback
  const selectedProjectRef = useRef<string | null>(null);
  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  // Generation counter disambiguating overlapping requests for the SAME
  // project name (name-only equality can't tell a stale re-fetch from the
  // latest one — e.g. reselecting a project, or a reconnect resync racing a
  // retry). Bumped by every fetch attempt and by a live SSE push, so only the
  // request started last is allowed to write state.
  const requestIdRef = useRef(0);

  const fetchProjectList = useCallback(async () => {
    // Snapshot (not bump) the generation before this request goes out. If a
    // fetchProjectState call — a Retry, a reselect, a reconnect resync — or a
    // live state_change push settles anything for the selected project while
    // this list request is in flight, it bumps requestIdRef past this
    // snapshot, and that fresher truth must win over this request's
    // now-stale view of hasMalformedState below.
    const requestId = requestIdRef.current;
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const fetchedProjects: ProjectSummary[] = data.projects ?? [];
        setProjects(fetchedProjects);

        // The list is the only source that refreshes hasMalformedState, and it
        // can be refetched by an event unrelated to the selected project (e.g.
        // another project's add/remove). If it now reports the selected
        // project as malformed, any state we're already holding for it predates
        // that discovery — fetchProjectState never refreshes this flag — so it
        // must not be left around to coincidentally satisfy selectProjectView's
        // malformed-recovered-via-retry carve-out until a fresh fetchProjectState
        // re-confirms the project is actually readable again.
        const selected = selectedProjectRef.current;
        const selectedSummary = selected ? fetchedProjects.find((p) => p.name === selected) : undefined;
        if (selected && selectedSummary?.hasMalformedState && requestIdRef.current === requestId) {
          setProjectState((prev) => (prev?.owner === selected ? null : prev));
          setStateSettledFor((prev) => (prev === selected ? null : prev));
        }
      }
    } catch {
      // Silently ignore — primary fetch handles errors
    }
  }, []);

  const fetchProjectState = useCallback(async (name: string) => {
    setProjectState(null);
    setIsLoading(true);
    setError(null);
    setStateSettledFor(null);

    // Claim this generation so a later-started request for the same project
    // name (a reselect, or a reconnect resync) can outrank us even though the
    // name comparison alone can't tell the two apart.
    const requestId = ++requestIdRef.current;

    // A newer project — or a newer request for the same project — took over
    // while this request was in flight. Bail before touching any state: the
    // page reads state, error and the settled marker as facts about the
    // project on screen, so a stale resolution must not land on top of them.
    const stillCurrent = () => name === selectedProjectRef.current && requestId === requestIdRef.current;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(name)}/state`);

      if (res.ok) {
        const data = await res.json();
        if (!stillCurrent()) return;
        setProjectState({ owner: name, state: data.state });
      } else if (res.status === 404) {
        if (!stillCurrent()) return;
        setProjectState(null);
      } else if (res.status === 422) {
        const data = await res.json();
        if (!stillCurrent()) return;
        setProjectState(null);
        setError({ owner: name, message: data.error ?? "Malformed state.json" });
      } else {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        if (!stillCurrent()) return;
        setError({ owner: name, message: data.error ?? `Unexpected error (${res.status})` });
      }
      setStateSettledFor(name);
    } catch (err) {
      if (!stillCurrent()) return;
      setError({
        owner: name,
        message: err instanceof Error ? err.message : "Failed to fetch project state",
      });
      setStateSettledFor(name);
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, []);

  const handleSSEEvent = useCallback(
    (event: SSEEvent) => {
      const currentSelected = selectedProjectRef.current;

      switch (event.type) {
        case "state_change": {
          const payload = event.payload as { projectName: string; state: AnyProjectState };

          // Unconditionally patch the projects array (sidebar reactivity).
          // v5 and v6 are structurally identical (both have .graph/.pipeline/
          // .project), so derive from the graph uniformly and discriminate only
          // the reported schemaVersion. AnyProjectState is exactly v5|v6, so no
          // other branch is needed.
          {
            const state = payload.state;
            const tier =
              state.graph.status === 'completed'
                ? 'complete'
                : state.pipeline.current_tier;
            const planningStatus = derivePlanningStatus(state.graph.nodes, state.graph.status);
            const executionStatus = deriveExecutionStatus(
              state.graph.status,
              state.graph.nodes,
            );
            setProjects(prev =>
              prev.map(p =>
                p.name === payload.projectName
                  ? {
                      ...p,
                      tier,
                      planningStatus,
                      executionStatus,
                      lastUpdated: state.project?.updated,
                      schemaVersion: isV6State(state) ? 'v6' as const : 'v5' as const,
                      graphStatus: state.graph.status,
                    }
                  : p
              )
            );
          }

          // Existing behaviour: update detail view for the selected project.
          // Stamped with its owner like every other write, so a live push can
          // never install state the page would read as the selected project's.
          if (payload.projectName === currentSelected) {
            // The live push is authoritative: invalidate any in-flight fetch
            // for this project so it can't later stomp this state, clear a
            // stale error owned by this same project (a list-level error has
            // a null owner and must survive), and mark state settled so the
            // view doesn't keep showing a stale loading/error state over it.
            requestIdRef.current++;
            setError(prev => (prev && prev.owner === payload.projectName ? null : prev));
            setProjectState({ owner: payload.projectName, state: payload.state });
            setStateSettledFor(payload.projectName);
          }
          break;
        }
        case "connected": {
          // The shared connection just (re)opened. Refetch the list unconditionally,
          // and — when a project is selected — its state too: a tab that was
          // disconnected through a whole execution otherwise shows a stale plan
          // after the stream returns, with no event left to correct it.
          fetchProjectList();
          if (currentSelected) void fetchProjectState(currentSelected);
          break;
        }
        case "project_added": {
          fetchProjectList();
          break;
        }
        case "project_removed": {
          const payload = event.payload as { projectName: string };
          // Optimistic local removal for instant sidebar feedback.
          setProjects((prev) => prev.filter((p) => p.name !== payload.projectName));
          if (payload.projectName === currentSelected) {
            setSelectedProject(null);
            setProjectState(null);
          }
          // Then reconcile against the authoritative list. The lifecycle topic
          // coalesces latest-wins (maxQueuePerTopic = 1), so a burst of lifecycle
          // events collapses to the newest one. A surviving project_removed must
          // therefore refetch to recover any sibling lifecycle event the coalesce
          // window dropped (e.g. two removals in one window, or a removal that
          // landed after a coalesced-away project_added) — without it those
          // projects would linger stale until the next event or reconnect.
          fetchProjectList();
          break;
        }
        default:
          break;
      }
    },
    [fetchProjectList, fetchProjectState],
  );

  // Ride the single shared multiplexed EventSource instead of opening our own.
  // sseStatus/reconnect pass through from the provider unchanged so the page's
  // single-SSE-source-of-truth banner wiring still holds.
  const { sseStatus, reconnect, subscribe } = useSSEContext();

  useEffect(() => subscribe(handleSSEEvent), [subscribe, handleSSEEvent]);

  const selectProject = useCallback((name: string) => {
    // Claim ownership synchronously: fetchProjectState's in-flight guard reads
    // this ref, and the effect that syncs it only runs after the next render —
    // so without this the guard would still be comparing against the outgoing
    // project and would let its late response through.
    selectedProjectRef.current = name;
    setSelectedProject(name);
    try { localStorage.setItem(STORAGE_KEY, name); } catch { /* unavailable */ }
    const target = `/projects/${encodeURIComponent(name)}`;
    // Shallow URL update — NOT router.push. router.push re-keys the [[...slug]]
    // segment, which remounts the whole ProjectsPage subtree (including the
    // sidebar), wiping the sidebar's local search-filter state and refetching
    // (the "full page reload" jank). window.history.pushState updates the
    // address bar without a navigation, so the page only re-renders: the filter
    // survives selection. usePathname() (read side, page.tsx) tracks this shallow
    // update and drives selection. Mirrors the in-modal doc nav (page.tsx).
    if (pathname !== target) window.history.pushState(null, '', target);
    fetchProjectState(name);
  }, [fetchProjectState, pathname]);

  // Fetch project list on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchProjects() {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/projects", { cache: "no-store" });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Unknown error" }));
          if (!cancelled) {
            // A project-list failure belongs to no project — owner stays null so
            // the page renders it as the whole-list error it is.
            setError({ owner: null, message: data.error ?? `Failed to fetch projects (${res.status})` });
            setIsLoading(false);
          }
          return;
        }

        const data = await res.json();
        const fetchedProjects: ProjectSummary[] = data.projects ?? [];

        if (cancelled) return;

        setProjects(fetchedProjects);

        // A project named in the URL wins over the localStorage restore so a deep
        // link neither double-fetches nor lands on the wrong initial selection.
        let target: string | null = null;
        if (initialProject && fetchedProjects.some((p) => p.name === initialProject)) {
          target = initialProject;
        } else {
          let restored: string | null = null;
          try { restored = localStorage.getItem(STORAGE_KEY); } catch { /* unavailable */ }
          if (restored && fetchedProjects.some((p) => p.name === restored)) target = restored;
        }
        if (target) {
          const name = target;
          // Same synchronous ownership claim selectProject makes, for the same
          // reason: the user can pick another project while this restore's state
          // request is still in flight.
          selectedProjectRef.current = name;
          setSelectedProject(name);
          const requestId = ++requestIdRef.current;
          const stillCurrent = () =>
            !cancelled && name === selectedProjectRef.current && requestId === requestIdRef.current;
          try {
            const stateRes = await fetch(`/api/projects/${encodeURIComponent(name)}/state`);
            if (!stillCurrent()) return;
            if (stateRes.ok) { const stateData = await stateRes.json(); if (!stillCurrent()) return; setProjectState({ owner: name, state: stateData.state }); }
            else if (stateRes.status === 404) { setProjectState(null); }
            else if (stateRes.status === 422) { const d = await stateRes.json(); if (!stillCurrent()) return; setProjectState(null); setError({ owner: name, message: d.error ?? "Malformed state.json" }); }
            else { const d = await stateRes.json().catch(() => ({ error: "Unknown error" })); if (!stillCurrent()) return; setError({ owner: name, message: d.error ?? `Unexpected error (${stateRes.status})` }); }
            setStateSettledFor(name);
          } catch (err) {
            if (!stillCurrent()) return;
            setError({ owner: name, message: err instanceof Error ? err.message : "Failed to fetch project state" });
            setStateSettledFor(name);
          }
        }

        if (!cancelled) {
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError({
            owner: null,
            message: err instanceof Error ? err.message : "Failed to fetch projects",
          });
          setIsLoading(false);
        }
      }
    }

    fetchProjects();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    projects,
    selectedProject,
    projectState,
    selectProject,
    isLoading,
    error,
    stateSettledFor,
    sseStatus,
    reconnect,
  };
}
