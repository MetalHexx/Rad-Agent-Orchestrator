"use client";
import * as React from "react";
import type { AgentNode, AgentTranscript } from "@rad-orchestration/telemetry";
import { flattenAgentTree, availableTranscriptIds, siblingNav } from "@/lib/observability/agent-nav";
import type { NavAgent } from "@/lib/observability/agent-nav";
import { useTranscriptLive } from "@/hooks/use-transcript-live";

// ---------------------------------------------------------------------------
// useSessionAgents — fetch the agent tree for a session (FR-12, AD-5)
// ---------------------------------------------------------------------------

export interface UseSessionAgentsResult {
  agents: AgentNode[];
  navList: NavAgent[];
  availableIds: Set<string>;
  loading: boolean;
}

export function useSessionAgents(sessionId: string | null): UseSessionAgentsResult {
  const [agents, setAgents] = React.useState<AgentNode[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!sessionId) {
      setAgents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/observability/transcripts/${sessionId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { tree: [] }))
      .then((json) => {
        if (!cancelled) {
          setAgents((json.tree as AgentNode[]) ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgents([]);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  const navList = React.useMemo(() => flattenAgentTree(agents), [agents]);
  const availableIds = React.useMemo(() => availableTranscriptIds(agents), [agents]);

  return { agents, navList, availableIds, loading };
}

// ---------------------------------------------------------------------------
// useAgentInspector — fetch the active transcript + live refresh + nav (FR-9, NFR-6, NFR-7)
// ---------------------------------------------------------------------------

export type InspectorFacet = 'raw' | 'tools' | 'files';

export interface UseAgentInspectorResult {
  transcript: AgentTranscript | undefined;
  loading: boolean;
  activeFacet: InspectorFacet;
  setActiveFacet: (f: InspectorFacet) => void;
  prevId: string | null;
  nextId: string | null;
}

export function useAgentInspector(
  sessionId: string | null,
  activeId: string | null,
  navList: NavAgent[],
): UseAgentInspectorResult {
  const [transcript, setTranscript] = React.useState<AgentTranscript | undefined>(undefined);
  const [loading, setLoading] = React.useState(false);
  const [activeFacet, setActiveFacet] = React.useState<InspectorFacet>('raw');

  const fetchTranscript = React.useCallback(() => {
    if (!sessionId || !activeId) {
      setTranscript(undefined);
      return;
    }
    setLoading(true);
    fetch(`/api/observability/transcripts/${sessionId}/${activeId}`, { cache: "no-store" })
      .then((res) => {
        if (res.status === 404) return { transcript: undefined };
        if (!res.ok) return { transcript: undefined };
        return res.json();
      })
      .then((json) => {
        setTranscript((json as { transcript?: AgentTranscript }).transcript);
        setLoading(false);
      })
      .catch(() => {
        setTranscript(undefined);
        setLoading(false);
      });
  }, [sessionId, activeId]);

  // Initial fetch + refetch when sessionId/activeId changes (AD-5)
  React.useEffect(() => {
    fetchTranscript();
  }, [fetchTranscript]);

  // Live refresh: subscribe to transcript_change SSE events, revalidate on match (NFR-7)
  useTranscriptLive(sessionId, fetchTranscript);

  // Sibling navigation derived from navList + activeId (FR-9)
  const { prevId, nextId } = React.useMemo(
    () => (activeId ? siblingNav(navList, activeId) : { prevId: null, nextId: null }),
    [navList, activeId],
  );

  return { transcript, loading, activeFacet, setActiveFacet, prevId, nextId };
}
