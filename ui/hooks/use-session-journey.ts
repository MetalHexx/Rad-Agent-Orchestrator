"use client";

import * as React from "react";
import { useSSEContext } from "@/hooks/use-sse-context";
import type { SSEEvent } from "@/types/events";
import type { JourneySession } from "@/lib/journey-model";

export type { JourneyActivity, JourneySession } from "@/lib/journey-model";

export interface UseSessionJourneyReturn {
  sessions: JourneySession[];
  totalActiveTimeMs: number;
  loaded: boolean;
}

async function fetchJourney(projectName: string): Promise<{ sessions: JourneySession[]; totalActiveTimeMs: number }> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/sessions`);
    if (!res.ok) return { sessions: [], totalActiveTimeMs: 0 };
    const json = await res.json();
    return {
      sessions: Array.isArray(json.sessions) ? (json.sessions as JourneySession[]) : [],
      totalActiveTimeMs: typeof json.totalActiveTimeMs === 'number' ? json.totalActiveTimeMs : 0,
    };
  } catch {
    return { sessions: [], totalActiveTimeMs: 0 };
  }
}

/**
 * Fetches a project's session journey on mount and on project change, and
 * refetches whenever a `sessions_change` nudge names this project — the same
 * snapshot + SSE-nudge + refetch loop `use-artifact-live.tsx` uses for
 * artifacts. No polling; the server holds the ordering and the active-time
 * math, this hook just renders what it's given.
 */
export function useSessionJourney(projectName: string): UseSessionJourneyReturn {
  const [sessions, setSessions] = React.useState<JourneySession[]>([]);
  const [totalActiveTimeMs, setTotalActiveTimeMs] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);

  const { subscribe } = useSSEContext();

  // Bumped on every fetch issued and on every project switch; a response is
  // only committed when it still matches the latest id, guarding against a
  // stale fetch resolving after the project (or a newer fetch) has moved on —
  // the same guard use-artifact-live.tsx and use-delete-project.ts both use.
  const requestIdRef = React.useRef(0);

  const refetch = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const result = await fetchJourney(projectName);
    if (requestId !== requestIdRef.current) return;
    setSessions(result.sessions);
    setTotalActiveTimeMs(result.totalActiveTimeMs);
    setLoaded(true);
  }, [projectName]);

  React.useEffect(() => {
    setLoaded(false);
    void refetch(); // bumps requestIdRef, which invalidates any fetch still in flight for the outgoing project
  }, [projectName, refetch]);

  React.useEffect(() => {
    return subscribe((ev: SSEEvent) => {
      if (ev.type !== "sessions_change") return;
      const payload = ev.payload as { projectName: string };
      if (payload.projectName !== projectName) return;
      void refetch();
    });
  }, [projectName, subscribe, refetch]);

  return { sessions, totalActiveTimeMs, loaded };
}
