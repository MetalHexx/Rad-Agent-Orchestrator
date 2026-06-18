import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { SSEEvent, SSEEventType, SSEPayloadMap } from '@/types/events';
import type { AnyProjectState } from '@/types/state';
import { getProjectsRoot, getRegistryRoot, getTelemetryRoot } from '@/lib/path-resolver';
import { getLiveRuntime } from '@/lib/live/live-hub-runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── SSE Helpers ────────────────────────────────────────────────────────────

function createSSEEvent<T extends SSEEventType>(
  type: T,
  payload: SSEPayloadMap[T],
): SSEEvent<T> {
  return {
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function formatSSE(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const absoluteProjectsDir = getProjectsRoot();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      // ── Safe enqueue ────────────────────────────────────────────────
      function enqueue(event: SSEEvent): void {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatSSE(event)));
        } catch {
          // Stream already closed — ignore
        }
      }

      // ── 1. Discover existing projects & send connected event ────────
      readdir(absoluteProjectsDir, { withFileTypes: true })
        .then((entries) => {
          const projects = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
          enqueue(createSSEEvent('connected', { projects }));
        })
        .catch((err) => {
          console.error('[SSE] Failed to discover projects:', err);
          enqueue(createSSEEvent('connected', { projects: [] }));
        });

      // ── 2. Heartbeat interval (30s) ────────────────────────────────
      const heartbeatInterval = setInterval(() => {
        enqueue(createSSEEvent('heartbeat', {} as Record<string, never>));
      }, 30_000);

      // ── 3. Subscribe to the shared artifact hub (O(1) watcher) ─────
      // The hub lazily warms a single process-level watcher shared across
      // all SSE connections. Each connection registers a connection-scoped
      // all-topics subscriber that fans in every project's artifact topic.
      // The route constructs zero watchers of its own — every live event
      // flows through the process-level singleton hub watches, and the hub
      // owns coalescing.
      const liveRuntime = getLiveRuntime({
        projectsRoot: absoluteProjectsDir,
        registryRoot: getRegistryRoot(),
        telemetryRoot: path.join(getTelemetryRoot(), 'usage'),
      });
      const unsubArtifacts = liveRuntime.subscribeAllArtifactTopics((n) =>
        enqueue(createSSEEvent('artifact_change', n.payload)),
      );
      const unsubDegraded = liveRuntime.subscribeDegraded((n) =>
        enqueue(createSSEEvent('live_degraded', n.payload)),
      );
      const unsubTelemetry = liveRuntime.subscribeTelemetry((n) =>
        enqueue(createSSEEvent('telemetry_rows', n.payload)),
      );
      const unsubState = liveRuntime.subscribeAllStateTopics((n) =>
        enqueue(
          createSSEEvent('state_change', {
            projectName: n.payload.projectName,
            state: n.payload.state as AnyProjectState,
          }),
        ),
      );
      const unsubRegistry = liveRuntime.subscribeRegistry(() =>
        enqueue(createSSEEvent('registry_change', {} as Record<string, never>)),
      );
      const unsubLifecycle = liveRuntime.subscribeLifecycle((n) => {
        const { projectName } = n.payload;
        if (n.type === 'project_added') {
          enqueue(createSSEEvent('project_added', { projectName }));
        } else {
          enqueue(createSSEEvent('project_removed', { projectName }));
        }
      });

      // ── 4. Cleanup on disconnect ───────────────────────────────────
      function cleanup(): void {
        if (closed) return;
        closed = true;

        clearInterval(heartbeatInterval);
        unsubArtifacts();
        unsubDegraded();
        unsubTelemetry();
        unsubState();
        unsubRegistry();
        unsubLifecycle();

        try {
          controller.close();
        } catch {
          // Already closed — ignore
        }
      }

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
