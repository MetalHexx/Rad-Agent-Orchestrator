import type { ReactNode } from 'react';
import type {
  AnyProjectState,
  NodeState,
  IterationEntry,
  CorrectiveTaskEntry,
  RepoCommitEntry,
} from '@/types/state';

/**
 * The set of card states the resolver can name. Each concrete state view is a
 * pure registry entry keyed by one of these; `fallback` is the catch-all for
 * an unmapped / unknown current node. Only `fallback` is registered today —
 * the per-node business views land in later tasks as additional entries.
 */
export type StateId =
  | 'planning'
  | 'plan-approval'
  | 'coding'
  | 'reviewing'
  | 'corrective'
  | 'phase-review'
  | 'final-review'
  | 'complete'
  | 'fallback';

/**
 * The derived essentials every state view reads, assembled once by the resolver
 * so views stay thin (no re-deriving of phase/iteration/repo data). The card's
 * three fixed slots are filled from these values.
 */
export interface StateViewContext {
  /** The full project state the card was rendered against. */
  state: AnyProjectState;
  /** The `StateId` the resolver mapped the active node to. */
  stateId: StateId;
  /** Leaf segment of the focus/current path (e.g. `task_executor`). */
  nodeId: string;
  /** The node object resolved by descending the dotted path, if it exists. */
  node: NodeState | undefined;
  /** True when the active path descends through a `.ct{N}.` corrective segment. */
  isCorrective: boolean;
  /** Innermost iteration entry descended into, if the path entered a loop. */
  iteration: IterationEntry | undefined;
  /** Corrective-task entry descended into, if the path entered `.ct{N}.`. */
  correctiveEntry: CorrectiveTaskEntry | undefined;
  /** Current phase display name derived from the top-level `phase_loop`. */
  phaseName: string | null;
  /** Completed / total phases derived from the top-level `phase_loop`. */
  phaseProgress: { completed: number; total: number } | null;
  /** Repos of the enclosing iteration / corrective entry (empty when none). */
  repos: RepoCommitEntry[];
  /** PR URL surfaced by the completion states; `null` when unavailable. */
  prUrl: string | null;
  onDocClick: (path: string) => void;
  compareUrlByRepo: Record<string, string | null>;
  projectName: string;
}

/**
 * A registry entry: identifies its `StateId` and renders the card's inner
 * content for a resolved context. Views compose the fixed slot wrappers
 * (`card-slots`) so the shell keeps sole ownership of slot geometry.
 */
export interface StateView {
  id: StateId;
  render(ctx: StateViewContext): ReactNode;
}

/** The three fixed slots the shell lays out; views fill them, never size them. */
export type CardSlotName = 'ring' | 'title' | 'controls';

export interface CardSlotProps {
  children?: ReactNode;
  className?: string;
}
