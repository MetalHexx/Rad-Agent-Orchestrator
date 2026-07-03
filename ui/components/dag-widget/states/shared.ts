import type { CSSProperties } from 'react';
import type { IterationEntry } from '@/types/state';

/**
 * Builds a style object that overrides `--primary` for the wrapped subtree so
 * `DocumentLink`'s hard-coded `text-primary` icon/label resolve to `cssVar`
 * instead of the app default — `DocumentLink` itself stays untouched. Works
 * because the compiled `.text-primary` rule reads `color: var(--primary)`
 * directly (Tailwind v4 `@theme inline`), so redefining `--primary` on an
 * ancestor retints every `text-primary` descendant.
 */
export function tierTintStyle(cssVar: string): CSSProperties {
  return { '--primary': `var(${cssVar})` } as CSSProperties;
}

/**
 * Ring arc `{ value, max }` from a `{ completed, total }` progress pair. Falls
 * back to an empty-but-valid `{ 0, 1 }` domain (never `{ 0, 0 }`, which would
 * hand the ring a degenerate arc domain) when no progress is derivable yet.
 * The caller decides which progress the arc means — task-scoped for the
 * work states, phase-scoped for the review milestones.
 */
export function deriveRingArc(
  progress: { completed: number; total: number } | null,
): { value: number; max: number } {
  if (progress === null || progress.total <= 0) return { value: 0, max: 1 };
  return { value: progress.completed, max: progress.total };
}

/** 1-based task number for display, derived from the active task iteration. */
export function deriveTaskNumber(iteration: IterationEntry | undefined): number | null {
  return iteration ? iteration.index + 1 : null;
}

/** `PR #{n}` label parsed from a GitHub pull-request URL; `PR` when the number can't be read. */
export function parsePrLabel(url: string): string {
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `PR #${match[1]}` : 'PR';
}
