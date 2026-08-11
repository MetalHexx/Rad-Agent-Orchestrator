import type { AnyProjectState, CorrectiveTaskEntry } from '@/types/state';

/**
 * Fallback retry ceiling used when a snapshot omits
 * `config.limits.max_retries_per_task` — typed as required on both
 * `StateConfigLimits` (v5) and `V6StateConfigLimits` (v6), but not
 * guaranteed at runtime for a stale or hand-edited state file.
 */
export const DEFAULT_MAX_RETRIES_PER_TASK = 5;

/** Retry ceiling from the state's own config snapshot, with the documented fallback. */
export function resolveMaxRetriesPerTask(state: AnyProjectState): number {
  return state.config.limits.max_retries_per_task ?? DEFAULT_MAX_RETRIES_PER_TASK;
}

/** Window-relative retry budget: the attempt within the current window, the ceiling, and the rendered label. */
export interface RetryBudget {
  attempt: number;
  max: number;
  label: string;
}

/**
 * Window-relative retry budget for one corrective entry. `budgetOrigin` is the
 * host's `corrective_budget_origin` (0 for iteration hosts). Returns null when
 * the entry predates the current window (attempt < 1) — a spent-window entry
 * stays on the timeline as history but carries no live budget reading.
 */
export function deriveRetryBudget(
  entry: CorrectiveTaskEntry | undefined,
  state: AnyProjectState,
  budgetOrigin = 0,
): RetryBudget | null {
  if (!entry) return null;
  const attempt = entry.index - budgetOrigin;
  if (attempt < 1) return null;
  const max = resolveMaxRetriesPerTask(state);
  return { attempt, max, label: `${attempt}/${max}` };
}
