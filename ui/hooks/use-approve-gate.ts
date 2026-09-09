"use client";

import { useState, useCallback } from "react";
import type { GateEvent, GateErrorResponse, GateApproveResponse } from "@/types/state";

/** Structured error object surfaced by the hook. */
export interface UseApproveGateError {
  message: string;
  detail?: string;
}

interface UseApproveGateReturn {
  /** Invoke the gate approval API. Never throws — errors captured in `error` state. */
  approveGate: (projectName: string, event: GateEvent) => Promise<GateApproveResponse | null>;
  /** True while the API call is in flight. */
  isPending: boolean;
  /** Structured error with message and optional raw pipeline detail, or null. */
  error: UseApproveGateError | null;
  /** Clear the current error state. */
  clearError: () => void;
}

export function useApproveGate(): UseApproveGateReturn {
  const [isPending, setIsPending] = useState<boolean>(false);
  const [error, setError] = useState<UseApproveGateError | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const approveGate = useCallback(
    async (projectName: string, event: GateEvent): Promise<GateApproveResponse | null> => {
      setIsPending(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectName)}/gate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event }),
          }
        );

        if (res.ok) {
          try {
            return (await res.json()) as GateApproveResponse;
          } catch {
            // A 200 whose body will not parse is still a landed approval —
            // treat it as success (never null), or the dialog would stay
            // open on an approval that actually succeeded.
            return { success: true, action: "" };
          }
        }

        try {
          const parsed: GateErrorResponse = await res.json();
          setError({ message: parsed.error, detail: parsed.detail });
        } catch {
          setError({
            message: `Approval request failed (HTTP ${res.status}).`,
          });
        }

        return null;
      } catch {
        setError({
          message:
            "Network error. Please check your connection and try again.",
        });
        return null;
      } finally {
        setIsPending(false);
      }
    },
    []
  );

  return { approveGate, isPending, error, clearError };
}
