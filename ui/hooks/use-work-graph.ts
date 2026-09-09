'use client';

import { useEffect, useState } from 'react';
import type { WorkGraphResponse } from '@/types/work-graph';

export interface UseWorkGraphResult {
  data: WorkGraphResponse | null;
  status: 'loading' | 'error' | 'loaded';
  errorMessage: string;
}

/**
 * Fetches `/api/work-graph` for the given scope and refetches on scope change.
 * A refetch retains the last successful `data` — the toolbar reads
 * `data.groups` and `data.danglingEdgeCount`, and nulling it on every scope
 * change would collapse the Group select the viewer is mid-interaction with.
 * Only a hard failure clears it.
 */
export function useWorkGraph(scope: string): UseWorkGraphResult {
  const [data, setData] = useState<WorkGraphResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'loaded'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let aborted = false;

    async function load() {
      setStatus('loading');

      try {
        const res = await fetch(`/api/work-graph?group=${encodeURIComponent(scope)}`);
        if (!res.ok) {
          let msg = 'Failed to load the work graph.';
          try {
            const body = await res.json();
            if (body.error) msg = body.error;
          } catch {
            // body isn't JSON — fall back to the generic message
          }
          throw new Error(msg);
        }

        const json = (await res.json()) as WorkGraphResponse;
        if (!aborted) {
          setData(json);
          setStatus('loaded');
        }
      } catch (err) {
        if (!aborted) {
          setData(null);
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load the work graph.');
          setStatus('error');
        }
      }
    }

    load();

    return () => {
      aborted = true;
    };
  }, [scope]);

  return { data, status, errorMessage };
}
