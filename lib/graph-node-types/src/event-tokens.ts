import type { EventToken, NodeTypeName } from '@rad-orchestration/graph-engine';

/**
 * The exhaustive `<type>.<outcome>` event-token vocabulary a built-in node type's own `handle`
 * routes on, normalizing today's `runtime-config/action-events` catalog onto the scoped scheme:
 *
 * - `execute_task` / `task_completed` becomes `rad-orc:task.completed`.
 * - The three per-level reviewer spawns (`spawn_code_reviewer`, `spawn_phase_reviewer`,
 *   `spawn_final_reviewer`) and their `*_review_completed` events fold onto one
 *   `rad-orc:code_review.reviewed` — the task/phase/final levels are disambiguated by a `level`
 *   field the envelope carries, not by a separate token per level.
 * - The task/phase gate approvals (`task_gate_approved`, `phase_gate_approved`) likewise fold
 *   onto one `rad-orc:approval.decided` + `level`, disambiguated further by a `decision`
 *   (`granted`/`denied`) field — never a separate token per verdict.
 * - Gate rejections (`gate_rejected`) are dropped outright: a rejection routes straight into the
 *   engine's own corrective primitive, never through a node's `handle` — there is no outcome to
 *   name.
 * - `master_plan_completed` becomes `rad-orc:master_plan.authored`.
 * - `explosion_completed`/`explosion_failed` become `rad-orc:explosion.parsed`/
 *   `rad-orc:explosion.parse_failed`.
 * - `pr_created` becomes `rad-orc:pr.created`.
 * - The plan-audit's spawned-auditor completion becomes `rad-orc:plan_audit.audited` — a neutral
 *   completion signal; the service's resolver doc-reads the report's `verdict` (`approved` /
 *   `issues_found` are the routed outcomes `handle` branches on, never tokens of their own).
 * - Project-bootstrap and terminal actions with no per-node `handle` to route (`gate_mode_set`,
 *   `plan_approved`/`plan_rejected`, `final_approved`/`final_rejected`, `pr_requested`, `halt`,
 *   `start`, `display_complete`/`display_halted`) are out of scope for this map — they are
 *   root/pipeline level, never dispatched against a registry-resolved node type.
 */
export const EVENT_TOKENS = [
  'rad-orc:task.completed',
  'rad-orc:code_review.reviewed',
  'rad-orc:approval.decided',
  'rad-orc:master_plan.authored',
  'rad-orc:explosion.parsed',
  'rad-orc:explosion.parse_failed',
  'rad-orc:pr.created',
  'rad-orc:plan_audit.audited',
] as const satisfies readonly EventToken[];

/**
 * The same vocabulary, keyed by node type — the declaration a built-in's `handle` is written
 * against (one outcome per array entry, past-tense, never prefixed by the type it already
 * belongs to). Kept independent of {@link EVENT_TOKENS} on purpose so
 * {@link assertEventTokenCoherence} is a real coherence proof rather than a tautology: the two are
 * hand-authored separately, and a drift between them is a bug this assertion catches.
 */
export const BUILT_IN_ROUTED_OUTCOMES: Readonly<Record<NodeTypeName, readonly string[]>> = {
  'rad-orc:task': ['completed'],
  'rad-orc:code_review': ['reviewed'],
  'rad-orc:approval': ['decided'],
  'rad-orc:master_plan': ['authored'],
  'rad-orc:explosion': ['parsed', 'parse_failed'],
  'rad-orc:pr': ['created'],
  'rad-orc:plan_audit': ['audited'],
};

/** Every token {@link BUILT_IN_ROUTED_OUTCOMES} implies but {@link EVENT_TOKENS} never declares, and vice versa. */
export interface EventTokenIncoherence {
  readonly missingTokens: readonly string[];
  readonly orphanTokens: readonly string[];
}

/**
 * Cross-checks `tokens` against `routedOutcomes`: a `missingTokens` entry is an outcome a built-in
 * routes on with no declared token; an `orphanTokens` entry is a declared token no built-in routes
 * on. Both empty means the map is coherent. A pure function over its inputs (never the module's
 * own constants directly) so the check itself is unit-testable against a crafted, deliberately
 * incoherent fixture.
 */
export function findEventTokenIncoherence(
  tokens: readonly string[],
  routedOutcomes: Readonly<Record<string, readonly string[]>>,
): EventTokenIncoherence {
  const tokenSet = new Set(tokens);
  const derived = new Set<string>();
  const missingTokens: string[] = [];

  for (const [type, outcomes] of Object.entries(routedOutcomes)) {
    for (const outcome of outcomes) {
      const token = `${type}.${outcome}`;
      derived.add(token);
      if (!tokenSet.has(token)) missingTokens.push(token);
    }
  }

  const orphanTokens = tokens.filter((token) => !derived.has(token));
  return { missingTokens, orphanTokens };
}

/**
 * Throws when `tokens`/`routedOutcomes` disagree — defaulting to the real
 * {@link EVENT_TOKENS}/{@link BUILT_IN_ROUTED_OUTCOMES} pair, so importing this module proves the
 * shipped map coherent at load time, not just when a test happens to call it.
 */
export function assertEventTokenCoherence(
  tokens: readonly string[] = EVENT_TOKENS,
  routedOutcomes: Readonly<Record<string, readonly string[]>> = BUILT_IN_ROUTED_OUTCOMES,
): void {
  const { missingTokens, orphanTokens } = findEventTokenIncoherence(tokens, routedOutcomes);
  if (missingTokens.length > 0) {
    throw new Error(`event-tokens: routed outcome(s) with no declared token: ${missingTokens.join(', ')}`);
  }
  if (orphanTokens.length > 0) {
    throw new Error(`event-tokens: declared token(s) with no routed outcome: ${orphanTokens.join(', ')}`);
  }
}

assertEventTokenCoherence();
