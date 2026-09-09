"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectSummary } from "@/types/components";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SortField = 'status' | 'name' | 'updated';

export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  primary: SortField;
  primaryDir: SortDirection;
  secondary: SortField | 'none';
  secondaryDir: SortDirection;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// FR-17 — within a same-status cluster the most recently touched project
// floats to the top. DD-2 — no migration code: users with a previously
// persisted `monitoring-ui-sort-config` continue to load their saved
// primary/secondary fields and directions on next visit; this default only
// takes effect when no persisted config exists or the persisted config
// fails the existing validation block in `useSortConfig`.
export const DEFAULT_SORT_CONFIG: SortConfig = {
  primary: 'status',
  primaryDir: 'asc',
  secondary: 'updated',
  secondaryDir: 'desc',
};

const STORAGE_KEY = "monitoring-ui-sort-config";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// FR-14 / AD-4 — Urgent-first priority map keyed off the same four fields
// the row badge reads (`tier`, `planningStatus`, `executionStatus`,
// `hasMalformedState`), plus a `portfolio` bucket keyed off `project_type`.
// Lower number = higher urgency = floats to top in `asc` ('Urgent first')
// direction. Slot 10 is the bottom (Not Initialized and any unrecognized
// combination — see AD-4 final clause).
const STATUS_PRIORITY_URGENT_FIRST = {
  halted: 0,
  malformed: 1,
  executing: 2,
  approved: 3,
  finalReview: 4,   // AD-5 — between Approved and Planning
  planning: 5,
  planned: 6,
  notStarted: 7,
  portfolio: 8,
  complete: 9,
  notInitialized: 10,
} as const;

// FR-15 / AD-4 — Done-first priority map. NOT a literal `priority * -1` of
// STATUS_PRIORITY_URGENT_FIRST: that would flip notInitialized to the top,
// contradicting the "pinned bottom in both directions" invariant. Built as
// an explicit lookup so the bottom-pin survives.
const STATUS_PRIORITY_DONE_FIRST = {
  complete: 0,
  notStarted: 1,
  planned: 2,
  planning: 3,
  finalReview: 4,
  approved: 5,
  executing: 6,
  malformed: 7,
  halted: 8,
  portfolio: 9,
  notInitialized: 10,   // FR-15 — still bottom
} as const;

type StatusBucket = keyof typeof STATUS_PRIORITY_URGENT_FIRST;

function classifyStatus(p: ProjectSummary): StatusBucket {
  const { tier, planningStatus, executionStatus, hasMalformedState } = p;

  if (hasMalformedState) return 'malformed';
  // A portfolio root has no pipeline of its own to report — its badge fully
  // replaces the state badge (KIND_PRESENTATION.portfolio.replacesStateBadge),
  // so this is checked before the halted check: a portfolio directory that
  // still carries a stale halted state.json must not sort into the Halted
  // bucket while showing a Portfolio badge.
  if (p.project_type === 'portfolio') return 'portfolio';
  // tier === 'execution' AND executionStatus === 'halted' renders as Halted
  // in the badge; same source-of-truth for sort.
  if (tier === 'halted' || executionStatus === 'halted') return 'halted';

  if (tier === 'execution') {
    if (executionStatus === 'in_progress') return 'executing';
    // not_started | complete | undefined → Approved badge
    return 'approved';
  }

  if (tier === 'review') return 'finalReview';

  if (tier === 'planning') {
    if (planningStatus === 'in_progress') return 'planning';
    if (planningStatus === 'complete') return 'planned';
    if (planningStatus === undefined) return 'planning';  // FR-14 — v4 backward-compat: badge renders "Planning" for undefined planningStatus
    return 'notStarted';                                  // planningStatus === 'not_started' — badge renders "Not Started"
  }

  if (tier === 'complete') return 'complete';

  // tier === 'not_initialized' or any unrecognized combination — pin to bottom.
  return 'notInitialized';
}

function compareField(
  a: ProjectSummary,
  b: ProjectSummary,
  field: SortField,
  dir: SortDirection
): number {
  if (field === 'status') {
    const aBucket = classifyStatus(a);
    const bBucket = classifyStatus(b);
    const map = dir === 'desc' ? STATUS_PRIORITY_DONE_FIRST : STATUS_PRIORITY_URGENT_FIRST;
    return map[aBucket] - map[bBucket];
  }

  if (field === 'name') {
    const result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return dir === 'desc' ? result * -1 : result;
  }

  // field === 'updated'
  // FR-16 — undefined lastUpdated is treated as "older than any defined
  // date." Encoded by mapping undefined to the empty string and letting
  // the lexicographic comparison flow through `dir`. The empty string is
  // less than any ISO 8601 timestamp ('2024…' starts with '2'), so:
  //   asc  → undefined first  (Oldest first)
  //   desc → undefined last   (Newest first)
  const aKey = a.lastUpdated ?? '';
  const bKey = b.lastUpdated ?? '';
  const result =
    aKey < bKey ? -1 :
    aKey > bKey ? 1 :
    0;
  return dir === 'desc' ? result * -1 : result;
}

// ─── Comparator ──────────────────────────────────────────────────────────────

export function compareSortConfig(
  a: ProjectSummary,
  b: ProjectSummary,
  config: SortConfig
): number {
  const primary = compareField(a, b, config.primary, config.primaryDir);
  if (primary !== 0) return primary;

  if (config.secondary === 'none') return 0;

  return compareField(a, b, config.secondary, config.secondaryDir);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseSortConfigReturn {
  config: SortConfig;
  setConfig: (config: SortConfig) => void;
}

export function useSortConfig(): UseSortConfigReturn {
  const [config, setConfigState] = useState<SortConfig>(DEFAULT_SORT_CONFIG);

  // Read from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          parsed &&
          typeof parsed === 'object' &&
          (parsed.primary === 'status' || parsed.primary === 'name' || parsed.primary === 'updated') &&
          (parsed.primaryDir === 'asc' || parsed.primaryDir === 'desc') &&
          (parsed.secondary === 'none' || parsed.secondary === 'status' || parsed.secondary === 'name' || parsed.secondary === 'updated') &&
          (parsed.secondaryDir === 'asc' || parsed.secondaryDir === 'desc')
        ) {
          setConfigState(parsed as SortConfig);
        } else {
          setConfigState(DEFAULT_SORT_CONFIG);
        }
      }
    } catch {
      // Missing, malformed, or localStorage unavailable — use default
    }
  }, []);

  const setConfig = useCallback((newConfig: SortConfig) => {
    setConfigState(newConfig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
    } catch {
      // Silently ignore write errors
    }
  }, []);

  return { config, setConfig };
}
