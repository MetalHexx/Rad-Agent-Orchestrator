import type { AgentName } from '@rad-orchestration/graph-engine';

// Default budget when `maxRetries` is not provided in a corrective context.
const DEFAULT_MAX_RETRIES = 5;

/**
 * Resolves the appropriate coder agent based on task complexity and corrective escalation.
 *
 * Base tier: `simple → 'coder-junior'`; `standard` and `complex` → `'coder'`.
 *
 * Break-glass escalation (when `correctiveIndex` is present):
 * - Calculate `remaining = maxRetries - correctiveIndex` (attempts left after this one)
 * - `remaining > 2`: base tier
 * - `remaining === 2`: one step up (junior→coder; coder→coder)
 * - `remaining <= 1`: coder-senior
 *
 * With the default budget of 5: attempts 1–2 keep base tier, attempt 3 steps a junior
 * up to coder, attempts 4–5 go coder-senior.
 *
 * D18: The escalation ladder is budget-driven because remaining attempts (not just raw
 * attempt count) determine whether to escalate: a junior with two attempts left gets stepped
 * up to a stronger coder for the marginal shots at resolution.
 */
export function resolveCoderAgent(input: {
  complexity: 'simple' | 'standard' | 'complex';
  /** 1-based attempt index; absent on a first, non-corrective dispatch. */
  correctiveIndex?: number;
  /** The retry budget the corrective primitive stamped; absent means "not correcting". */
  maxRetries?: number;
}): AgentName {
  // Base tier: simple → junior, standard/complex → regular coder
  // D18: Tier table pinning the base assignment, before any break-glass escalation.
  const baseTier: { [key in 'simple' | 'standard' | 'complex']: AgentName } = {
    simple: 'coder-junior',
    standard: 'coder',
    complex: 'coder',
  };

  const base = baseTier[input.complexity];

  // If not in a corrective context, return the base tier immediately.
  if (input.correctiveIndex === undefined) {
    return base;
  }

  // In a corrective context: calculate remaining attempts and apply escalation.
  const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
  const remaining = maxRetries - input.correctiveIndex;

  // D18: Escalation is driven by budget remaining: with fewer attempts left,
  // we escalate to a stronger agent to improve the odds on the marginal shots.
  if (remaining > 2) {
    // Still have buffer; stick with base.
    return base;
  }

  if (remaining === 2) {
    // One step up: junior→coder; coder→coder (no further escalation yet).
    if (base === 'coder-junior') {
      return 'coder';
    }
    return base;
  }

  // remaining <= 1 (last 1–2 attempts): escalate to senior.
  return 'coder-senior';
}

/**
 * Resolves the appropriate reviewer agent based on review level and task complexity.
 *
 * Task level: `simple → 'reviewer-junior'`; `standard` and `complex` → `'reviewer'`.
 * Phase and final levels: always `'reviewer'`, regardless of complexity.
 *
 * There is no reviewer-senior tier and no break-glass escalation for reviewers.
 */
export function resolveReviewerAgent(input: {
  level: 'task' | 'phase' | 'final';
  complexity?: 'simple' | 'standard' | 'complex';
}): AgentName {
  // Phase and final reviews always use the regular reviewer, regardless of complexity.
  if (input.level === 'phase' || input.level === 'final') {
    return 'reviewer';
  }

  // Task level: apply the complexity tier.
  // D18: Task-level complexity drives the base reviewer tier; simpler tasks get junior reviewers.
  const complexity = input.complexity ?? 'standard';
  if (complexity === 'simple') {
    return 'reviewer-junior';
  }

  return 'reviewer';
}
