import type { AnyProjectState } from './state';
import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import type { DerivedProjectState } from '@rad-orchestration/work-graph';

/** SSE event types sent from server to client */
export type SSEEventType =
  | 'state_change'
  | 'project_added'
  | 'project_removed'
  | 'connected'
  | 'heartbeat'
  | 'artifact_change'
  | 'live_degraded'
  | 'registry_change'
  | 'telemetry_rows'
  | 'transcript_change'
  | 'sessions_change';

export interface SSEEvent<T extends SSEEventType = SSEEventType> {
  type: T;
  timestamp: string;      // ISO 8601
  payload: SSEPayloadMap[T];
}

export interface SSEPayloadMap {
  state_change: {
    projectName: string;
    state: AnyProjectState;   // was ProjectState — now accepts both v5 and v6
    /** Server-derived canonical state — the client patches its badge from this, never recomputes it. */
    projectState: DerivedProjectState;
  };
  project_added: {
    projectName: string;
  };
  project_removed: {
    projectName: string;
  };
  connected: {
    projects: string[];
  };
  heartbeat: Record<string, never>;
  artifact_change: {
    projectName: string;
    kind: 'added' | 'changed' | 'removed';
  };
  live_degraded: {
    degraded: boolean;
  };
  registry_change: Record<string, never>;
  telemetry_rows: { rows: ObservabilityUsageRow[] };
  transcript_change: { sessionId: string; agentId?: string; kind: 'added' | 'changed' | 'removed' };
  sessions_change: { projectName: string };
}

/** Single-source-of-truth runtime array of all registered SSE event names.
 *  The client registers an EventSource listener for each entry — an event NOT
 *  in this array is silently dropped by the browser (FR-14). */
export const EVENT_TYPES: SSEEventType[] = [
  'connected',
  'state_change',
  'project_added',
  'project_removed',
  'heartbeat',
  'registry_change',
  'artifact_change',
  'live_degraded',
  'telemetry_rows',
  'transcript_change',
  'sessions_change',
];

/** Connection status for the SSE client hook */
export type SSEConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
