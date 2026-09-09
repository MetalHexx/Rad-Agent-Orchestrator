"use client";

import { useState, useCallback } from "react";

export interface UseDebriefLaunchReturn {
  /** POSTs { harness } to launch a portfolio debrief. Never throws — errors captured in `error` state. */
  launchDebrief: (projectName: string, harness: 'claude' | 'copilot') => Promise<boolean>;
  /** True while the launch request is in flight. */
  isPending: boolean;
  /** Raw error message from the failed request, or null. */
  error: string | null;
  /** Clear the current error state. */
  clearError: () => void;
}

export function useDebriefLaunch(): UseDebriefLaunchReturn {
  const [isPending, setIsPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const launchDebrief = useCallback(
    async (projectName: string, harness: 'claude' | 'copilot'): Promise<boolean> => {
      setIsPending(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectName)}/debrief/launch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ harness }),
          }
        );

        if (res.ok) {
          return true;
        }

        try {
          const parsed: { error?: string } = await res.json();
          setError(parsed.error ?? `Debrief launch failed (HTTP ${res.status}).`);
        } catch {
          setError(`Debrief launch failed (HTTP ${res.status}).`);
        }

        return false;
      } catch {
        setError(
          "Network error. Please check your connection and try again."
        );
        return false;
      } finally {
        setIsPending(false);
      }
    },
    []
  );

  return { launchDebrief, isPending, error, clearError };
}
