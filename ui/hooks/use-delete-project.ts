"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeletionPlan, DeletionReport, DeletionSkip } from "@rad-orchestration/work-graph";

export interface UseDeleteProjectReturn {
  plan: DeletionPlan | null;
  planError: string | null;
  report: DeletionReport | null;
  isPending: boolean;
  loadPlan: () => Promise<void>;
  confirm: (skip?: DeletionSkip[]) => Promise<boolean>;
  reset: () => void;
}

/**
 * Owns the two fetches behind the header delete flow: the removal-plan
 * preview (GET) and the delete itself (POST). Never navigates or manages
 * dialog visibility — that's the caller's concern.
 */
export function useDeleteProject(projectName: string): UseDeleteProjectReturn {
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [report, setReport] = useState<DeletionReport | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Identifies the "current" request. Bumped on every new loadPlan()/confirm()
  // call, on project switch, and on reset() — a fetch whose id no longer
  // matches when it resolves is stale and must not commit its result.
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
  }, [projectName]);

  const loadPlan = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setPlanError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/remove`);
      const json = await res.json().catch(() => ({}));
      if (requestId !== requestIdRef.current) return;
      if (!res.ok) {
        setPlanError(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
        return;
      }
      setPlan(json.plan as DeletionPlan);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setPlanError(err instanceof Error ? err.message : "Request failed.");
    }
  }, [projectName]);

  const confirm = useCallback(async (skip?: DeletionSkip[]): Promise<boolean> => {
    const requestId = ++requestIdRef.current;
    setPlanError(null);
    setIsPending(true);
    try {
      const hasSkip = !!skip && skip.length > 0;
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/remove`, {
        method: "POST",
        ...(hasSkip
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ skip }),
            }
          : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (requestId !== requestIdRef.current) return false;
      if (!res.ok) {
        setPlanError(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
        return false;
      }
      const nextReport = json.report as DeletionReport;
      setReport(nextReport);
      return nextReport.complete;
    } catch (err) {
      if (requestId !== requestIdRef.current) return false;
      setPlanError(err instanceof Error ? err.message : "Request failed.");
      return false;
    } finally {
      if (requestId === requestIdRef.current) setIsPending(false);
    }
  }, [projectName]);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setPlan(null);
    setPlanError(null);
    setReport(null);
  }, []);

  return { plan, planError, report, isPending, loadPlan, confirm, reset };
}
