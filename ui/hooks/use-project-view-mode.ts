"use client";

import { useCallback, useEffect, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProjectViewMode = 'overview' | 'pipeline';

// ─── Constants ───────────────────────────────────────────────────────────────

export const PROJECT_VIEW_MODE_STORAGE_KEY = 'monitoring-ui-project-view-mode';

// The Overview is where a project starts; the Pipeline view is the drill-in —
// this is the default for every project, including one with a pipeline and
// including a first-ever visit.
export const DEFAULT_PROJECT_VIEW_MODE: ProjectViewMode = 'overview';

// ─── Hook ────────────────────────────────────────────────────────────────────

interface UseProjectViewModeReturn {
  mode: ProjectViewMode;
  setMode: (m: ProjectViewMode) => void;
}

/**
 * Owns the operator's Overview/Pipeline preference. The value is global (one
 * key, no project name in it) — switching projects never resets it. Read
 * once on mount; a missing, malformed, or unavailable `localStorage` all
 * degrade to `DEFAULT_PROJECT_VIEW_MODE` rather than throwing.
 */
export function useProjectViewMode(): UseProjectViewModeReturn {
  const [mode, setModeState] = useState<ProjectViewMode>(DEFAULT_PROJECT_VIEW_MODE);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PROJECT_VIEW_MODE_STORAGE_KEY);
      if (stored === 'overview' || stored === 'pipeline') {
        setModeState(stored);
      } else {
        setModeState(DEFAULT_PROJECT_VIEW_MODE);
      }
    } catch {
      // Missing, malformed, or localStorage unavailable — use default
    }
  }, []);

  const setMode = useCallback((newMode: ProjectViewMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(PROJECT_VIEW_MODE_STORAGE_KEY, newMode);
    } catch {
      // Silently ignore write errors
    }
  }, []);

  return { mode, setMode };
}
