"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import type { ProjectSummary } from "@/types/components";
import type { AnyProjectState } from "@/types/state";
import { isV6State } from "@/types/state";
import type { SSEEvent, SSEConnectionStatus } from "@/types/events";
import { derivePlanningStatus, deriveExecutionStatus } from "@/lib/status-derivation";
import { useSSEContext } from "@/hooks/use-sse-context";

const STORAGE_KEY = "monitoring-ui-selected-project";

interface UseProjectsReturn {
  /** List of all discovered projects */
  projects: ProjectSummary[];
  /** Name of the currently selected project, or null */
  selectedProject: string | null;
  /** State for the selected project, or null if not available */
  projectState: AnyProjectState | null;
  /** Function to select a project by name */
  selectProject: (name: string) => void;
  /** True while any fetch is in progress */
  isLoading: boolean;
  /** Error message string, or null */
  error: string | null;
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
    useState<AnyProjectState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Stable ref for selectedProject to use inside the SSE callback
  const selectedProjectRef = useRef<string | null>(null);
  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  const fetchProjectList = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects ?? []);
      }
    } catch {
      // Silently ignore — primary fetch handles errors
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

          // Existing behaviour: update detail view for the selected project
          if (payload.projectName === currentSelected) {
            setProjectState(payload.state);
          }
          break;
        }
        case "connected":
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
    [fetchProjectList],
  );

  // Ride the single shared multiplexed EventSource instead of opening our own.
  // sseStatus/reconnect pass through from the provider unchanged so the page's
  // single-SSE-source-of-truth banner wiring still holds.
  const { sseStatus, reconnect, subscribe } = useSSEContext();

  useEffect(() => subscribe(handleSSEEvent), [subscribe, handleSSEEvent]);

  const fetchProjectState = useCallback(async (name: string) => {
    setProjectState(null);
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(name)}/state`);

      if (res.ok) {
        const data = await res.json();
        setProjectState(data.state);
      } else if (res.status === 404) {
        setProjectState(null);
      } else if (res.status === 422) {
        const data = await res.json();
        setProjectState(null);
        setError(data.error ?? "Malformed state.json");
      } else {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        setError(data.error ?? `Unexpected error (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch project state");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectProject = useCallback((name: string) => {
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
            setError(data.error ?? `Failed to fetch projects (${res.status})`);
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
          setSelectedProject(target);
          try {
            const stateRes = await fetch(`/api/projects/${encodeURIComponent(target)}/state`);
            if (cancelled) return;
            if (stateRes.ok) { const stateData = await stateRes.json(); setProjectState(stateData.state); }
            else if (stateRes.status === 404) { setProjectState(null); }
            else if (stateRes.status === 422) { const d = await stateRes.json(); setProjectState(null); setError(d.error ?? "Malformed state.json"); }
            else { const d = await stateRes.json().catch(() => ({ error: "Unknown error" })); setError(d.error ?? `Unexpected error (${stateRes.status})`); }
          } catch (err) {
            if (!cancelled) setError(err instanceof Error ? err.message : "Failed to fetch project state");
          }
        }

        if (!cancelled) {
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to fetch projects"
          );
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
    sseStatus,
    reconnect,
  };
}
