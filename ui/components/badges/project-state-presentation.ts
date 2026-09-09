import type { ProjectState } from "@/types/components";

/** Colour and motion for a canonical project state — never words. The
 *  visible label always comes from the state's own `PROJECT_STATE_LABELS`
 *  entry, never from this table. */
export interface StatePresentation {
  cssVar: string;
  isSpinning: boolean;
}

export const STATE_PRESENTATION: Record<ProjectState, StatePresentation> = {
  not_initialized: { cssVar: "--tier-not-initialized", isSpinning: false },
  not_started: { cssVar: "--tier-not-initialized", isSpinning: false },
  planning: { cssVar: "--tier-planning", isSpinning: true },
  planned: { cssVar: "--tier-planning", isSpinning: false },
  executing: { cssVar: "--tier-execution", isSpinning: true },
  pending_review: { cssVar: "--tier-review", isSpinning: false },
  halted: { cssVar: "--tier-halted", isSpinning: false },
  complete: { cssVar: "--tier-complete", isSpinning: false },
};
