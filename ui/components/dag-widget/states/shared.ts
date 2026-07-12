import type { CSSProperties } from 'react';
import type { AnyProjectState, CorrectiveTaskEntry, IterationEntry, NodesRecord } from '@/types/state';

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

/**
 * Tallies every `kind: 'step'` node reachable from `state.graph.nodes` —
 * phases, tasks, milestones, and injected correctives alike — into one
 * whole-graph `{ completed, total }` pair so a card's ring can read as
 * overall project progress instead of a phase/task-scoped slice. In-progress
 * steps count as completed for this tally so the first active step already
 * fills the ring instead of showing an empty arc. `gate` / `conditional` /
 * `parallel` / `for_each_phase` / `for_each_task` nodes are never counted
 * themselves, only recursed through to reach their nested step children.
 * `null` only for a graph with no step nodes at all.
 */
export function deriveWholeGraphProgress(
  state: AnyProjectState,
): { completed: number; total: number } | null {
  let completed = 0;
  let total = 0;

  function visitEntries(entries: (IterationEntry | CorrectiveTaskEntry)[]): void {
    for (const entry of entries) {
      visitNodes(entry.nodes);
      // A nested corrective's `corrective_tasks` is carried at runtime but not
      // typed on `CorrectiveTaskEntry` (only `IterationEntry` declares it), so
      // read it defensively — mirrors the resolver's walk (resolver.ts).
      const nested = (entry as { corrective_tasks?: CorrectiveTaskEntry[] }).corrective_tasks ?? [];
      visitEntries(nested);
    }
  }

  function visitNodes(nodes: NodesRecord): void {
    for (const node of Object.values(nodes)) {
      switch (node.kind) {
        case 'step':
          total += 1;
          if (node.status === 'completed' || node.status === 'in_progress') completed += 1;
          break;
        case 'parallel':
          visitNodes(node.nodes);
          break;
        case 'for_each_phase':
        case 'for_each_task':
          visitEntries(node.iterations);
          break;
        case 'gate':
        case 'conditional':
          break;
      }
    }
  }

  visitNodes(state.graph.nodes);
  return total > 0 ? { completed, total } : null;
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

/**
 * Reads the final review's doc path and verdict from the top-level
 * `final_review` node directly, independent of the resolved current node —
 * `graph.status === 'completed'` wins resolution regardless of the active
 * node (see the resolver), so `current_node_path` may point anywhere (or
 * nowhere) by the time the run completes, and a `final_pr` leaf resolves
 * `ctx.node` to the PR node rather than the review. Both Final Review and
 * Complete read through here rather than `ctx.node` so either milestone
 * renders correctly regardless of which leaf is actually active.
 */
export function deriveFinalReviewInfo(state: AnyProjectState): { docPath: string | null; verdict: string | null } {
  const node = state.graph.nodes['final_review'];
  if (!node || node.kind !== 'step') return { docPath: null, verdict: null };
  return { docPath: node.doc_path, verdict: node.verdict ?? null };
}

/**
 * True when the run is parked awaiting the human's final approval — the
 * `final_approval_gate` is active and not yet completed. The Final Review card
 * folds the whole completion phase (`final_review`, `pr_gate`, `final_pr`,
 * `final_approval_gate`), so it must gate its Approve action on this rather than
 * render it unconditionally like the plan-approval card. Mirrors the exact
 * predicate the timeline uses in `getRowButtonDescriptor`
 * (`dag-timeline-helpers.ts`) — deliberately independent of the review verdict,
 * since the gate stays active for a `changes_requested` verdict too.
 */
export function deriveFinalGatePending(state: AnyProjectState): boolean {
  const node = state.graph.nodes['final_approval_gate'];
  return node?.kind === 'gate' && node.gate_active === true && node.status !== 'completed';
}
