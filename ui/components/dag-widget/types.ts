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
 * pure registry entry keyed by one of these; every `StateId` below is
 * registered to a concrete view, with `fallback` the catch-all for an
 * unmapped / unknown current node.
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
  /**
   * Completed / total tasks within the active phase iteration's task loop —
   * the task-scoped progress the work-state rings (Coding/Reviewing/Corrective)
   * plot, distinct from the phase-scoped `phaseProgress` the review milestones
   * use. `null` when no phase iteration is active or it carries no task loop.
   */
  taskProgress: { completed: number; total: number } | null;
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

/** The four fixed regions the shell lays out; views fill them, never size them. */
export type CardSlotName = 'ring' | 'heading' | 'meta' | 'controls';

export interface CardSlotProps {
  children?: ReactNode;
  className?: string;
}

/**
 * Props for `HeadingSlot`. Takes the heading as a plain string (not
 * `children`) so the slot itself owns single-line truncation and can carry
 * the untruncated text as a `title` attribute.
 */
export interface HeadingSlotProps {
  heading: string;
  className?: string;
}

/**
 * Props for `MetaSlot`. `meta: null` renders nothing — a heading-only state
 * leaves no empty meta row behind for the anchor/centering layout to account
 * for.
 */
export interface MetaSlotProps {
  meta: string | null;
  className?: string;
}

/** The `{ heading, meta }` text `deriveCardHeading` derives for the active state. */
export interface CardHeading {
  heading: string;
  meta: string | null;
}
