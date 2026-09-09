/**
 * The amendment document: what it is, and how it is read.
 *
 * One per amendment, at the project root, named `{NAME}-AMENDMENT-{NN}.md` with
 * a zero-padded two-digit index. Frontmatter identifies it; the body is a
 * `## Rationale` section in the operator's own terms followed by phase and task
 * blocks in exactly the Master Plan's anchor form.
 *
 * The vocabulary is add, revise, and drop — an amendment is not merely additive.
 * A phase or task block introduced fresh is an add; a task block restating an
 * existing id in full is a revise; a bare id with no accompanying block is a
 * drop. `drops_phases` asserts which phases the drops empty, since a vanishing
 * phase has no block of its own to carry that fact.
 *
 * ```yaml
 * ---
 * project: "MYAPP"
 * type: amendment
 * amendment: 1
 * created: "2026-08-24"
 * adds_phases: [P04]
 * adds_tasks: [P02-T05, P04-T01, P04-T02]
 * revises_tasks: [P03-T01]
 * drops_tasks: [P03-T02]
 * drops_phases: []
 * ---
 * ```
 *
 * Because the blocks are the Master Plan's shape, the document is read by
 * `parseMasterPlan` itself — the rationale lands in `preamble`, the blocks in
 * `phases`. There is deliberately no second parser.
 *
 * The frontmatter carries no `repos:` key. The Master Plan parser gates its
 * whole target-repo enforcement block on a non-empty `repos:` seal, and it
 * enforces both-directions equality between that seal and the union of task
 * target repos — against a document holding only part of the plan, that always
 * fails. Leaving the key absent skips the branch; the merged-result repo check
 * in `merge-check.ts` is what actually guards repo scope.
 */

import path from 'node:path';
import { UserError } from '../../framework/errors.js';
import { parseMasterPlan } from '../explode-master-plan.js';
import type { ParsedMasterPlan } from '../explode-master-plan.js';

/** The declarations an amendment's frontmatter makes about its own contents. */
export interface AmendmentFrontmatter {
  /** The amendment's own 1-based index, or null when absent or not a positive integer. */
  amendmentIndex: number | null;
  /** Phase ids this amendment introduces, e.g. `["P04"]`. */
  addsPhases: string[];
  /** Task ids this amendment introduces, e.g. `["P02-T05", "P04-T01"]`. */
  addsTasks: string[];
  /** Task ids restated in full at their existing id, e.g. `["P03-T01"]`. */
  revisesTasks: string[];
  /** Task ids removed; no block accompanies them, e.g. `["P03-T02"]`. */
  dropsTasks: string[];
  /** Phase ids the merge will empty as a result of `dropsTasks` — asserted, not the cause. */
  dropsPhases: string[];
}

/**
 * Parse an amendment document. Throws `ParseError` with a file-absolute line,
 * exactly as the Master Plan parser does.
 */
export function parseAmendment(amendmentPath: string): ParsedMasterPlan {
  return parseMasterPlan(amendmentPath);
}

/**
 * Enforce the "one per amendment, at the project root, named
 * `{NAME}-AMENDMENT-{NN}.md`" invariant this module declares, before any verb
 * reads or writes anything.
 *
 * The invariant is load-bearing rather than cosmetic: the record written to
 * `state.project.amendments[].doc_path` is project-relative, while the
 * `## Amendments` bullet the Master Plan and Requirements carry links the
 * document by bare filename — a same-directory link that is simply broken for a
 * document living anywhere else.
 *
 * This is bad input, not an authoring fault: there is no line of a parsed
 * document to point at, so it surfaces as a `UserError` the way `guardProjectDir`
 * surfaces a malformed `--project-dir`.
 */
export function guardAmendmentPath(amendmentPath: string, projectDir: string, projectName: string): void {
  const resolvedProjectDir = path.resolve(projectDir);
  const resolved = path.resolve(resolvedProjectDir, amendmentPath);
  const relativeToProject = path.relative(resolvedProjectDir, resolved);

  if (relativeToProject !== path.basename(resolved)) {
    throw new UserError(
      `--amendment must name a document at the project root (${resolvedProjectDir}), got "${resolved}"`,
    );
  }

  const expected = new RegExp(`^${escapeRegExp(projectName)}-AMENDMENT-\\d{2,}\\.md$`);
  if (!expected.test(relativeToProject)) {
    throw new UserError(
      `--amendment must be named ${projectName}-AMENDMENT-{NN}.md, got "${relativeToProject}"`,
    );
  }
}

/** Neutralize regex metacharacters so an interpolated value matches literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read the amendment's self-declarations, normalising absent or malformed values. */
export function readAmendmentFrontmatter(frontmatter: Record<string, unknown>): AmendmentFrontmatter {
  const rawIndex = frontmatter['amendment'];
  const amendmentIndex =
    typeof rawIndex === 'number' && Number.isInteger(rawIndex) && rawIndex > 0 ? rawIndex : null;

  return {
    amendmentIndex,
    addsPhases: readIdList(frontmatter['adds_phases']),
    addsTasks: readIdList(frontmatter['adds_tasks']),
    revisesTasks: readIdList(frontmatter['revises_tasks']),
    dropsTasks: readIdList(frontmatter['drops_tasks']),
    dropsPhases: readIdList(frontmatter['drops_phases']),
  };
}

function readIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(entry => String(entry).trim()).filter(entry => entry.length > 0);
}
