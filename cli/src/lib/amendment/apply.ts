/**
 * The amendment transaction — validate, merge both halves, then commit as one.
 *
 * An amendment has no regeneration to fall back on and no undo: a half-landed one
 * would leave a Master Plan describing work that state.json does not carry, or the
 * reverse. So every write both halves produce is staged in memory first, and only
 * once the whole set exists does anything touch the disk. If a write fails mid-way,
 * the files this call created are removed and the ones it overwrote are restored
 * from the copies it took, leaving the project exactly as it was found.
 *
 * Drop is the first operation that *removes* files and state entries rather than
 * only adding or rewriting them, which is exactly why atomicity here is
 * load-bearing rather than merely tidy: a half-applied drop would leave a handoff
 * with no plan entry, or a state iteration with no handoff. Every staged deletion
 * therefore gets the same treatment as a staged write — its bytes are captured
 * before the unlink, so a failure partway through the commit puts it back exactly
 * where it was, beside every write and `state.json` itself.
 *
 * Validation is not re-implemented here. `buildMergePlan` is the same core the
 * `validate` command calls, which is what keeps "validate first" one implementation
 * rather than two that can disagree. Nothing in `lib/` may import from `commands/`,
 * so `apply` reaches that core directly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseMasterPlan, ParseError } from '../explode-master-plan.js';
import type { ParsedMasterPlan } from '../explode-master-plan.js';
import { toRelativeDocPath } from '../plan-emitters.js';
import { computeFrontier } from './frontier.js';
import type { PipelineState } from './frontier.js';
import { buildMergePlan } from './merge-check.js';
import type { AmendmentMergePlan, MergeError } from './merge-check.js';
import { mergeAmendmentIntoPlan } from './merge-plan.js';
import type { StagedDelete, StagedWrite } from './merge-plan.js';
import { mergeAmendmentIntoState } from './merge-state.js';
import type { AmendableState } from './merge-state.js';
import { guardAmendmentPath, parseAmendment } from './parse.js';

// ── Public surface ───────────────────────────────────────────────────────────

export interface AmendmentApplyOptions {
  projectDir: string;
  amendmentPath: string;
  /** Override for deterministic tests; defaults to `new Date().toISOString()`. */
  nowIso?: string;
}

/** What the transaction did, once it has committed. */
export interface AppliedAmendment {
  index: number;
  /** Project-relative path of the amendment document. */
  docPath: string;
  applied: string;
  addsPhases: AmendmentMergePlan['addsPhases'];
  addsTasks: AmendmentMergePlan['addsTasks'];
  revisesTasks: AmendmentMergePlan['revisesTasks'];
  dropsTasks: string[];
  dropsPhases: string[];
  renumbered: AmendmentMergePlan['renumbered'];
  /** The nodes the cascade reset, earliest first. */
  reopened: string[];
  clearedHalt: { node: string; reason: string } | null;
  /** Project-relative path of every file the transaction wrote, `state.json` last. */
  wrote: string[];
  /** Project-relative path of every file the transaction removed. */
  removed: string[];
}

export type AmendmentApplyOutcome =
  | { type: 'applied'; applied: AppliedAmendment }
  | { type: 'invalid'; error: MergeError }
  | { type: 'blocked'; blocked: { haltedNode: string; reason: string; message: string } };

const STATE_FILE = 'state.json';
const STATE_TMP_FILE = 'state.json.tmp';

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Apply an amendment to a project.
 *
 * Refuses before any write when the amendment does not merge — an authoring fault
 * comes back as `invalid` with a line against the amendment document, an
 * outstanding upstream halt as `blocked`. A genuine fault (no state.json, an
 * unreadable Master Plan, a failed commit) throws, as does an `--amendment` that
 * is not this project's own amendment document at its root.
 */
export function applyAmendment(opts: AmendmentApplyOptions): AmendmentApplyOutcome {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const { projectDir } = opts;

  const statePath = path.join(projectDir, STATE_FILE);
  // Kept as raw bytes: this is both the state to amend and the copy a failed
  // commit is restored from.
  const stateBefore = readFileOr(statePath, `the project's ${STATE_FILE}`);
  const state = JSON.parse(stateBefore.toString('utf-8')) as AmendableState;

  // The project name comes off state, so the guard cannot run before this read —
  // but it does run before the amendment document is opened or anything is written.
  const projectName = resolveProjectName(projectDir, state);
  guardAmendmentPath(opts.amendmentPath, projectDir, projectName);

  const masterPlanPath = resolveMasterPlanPath(projectDir, state);
  const masterPlanRaw = readFileOr(masterPlanPath, "the project's Master Plan").toString('utf-8');

  let existing: ParsedMasterPlan;
  try {
    existing = parseMasterPlan(masterPlanPath);
  } catch (err: unknown) {
    // A ParseError raised here carries a line against the MASTER PLAN. Handing it
    // back as `invalid` would send the amendment's author to a line of a file they
    // did not write, so an unreadable plan surfaces as the fault it is.
    throw new Error(`amendment apply: could not read the project's Master Plan at ${masterPlanPath}: ${messageOf(err)}`);
  }

  const frontier = computeFrontier(state, existing);
  let amendment: ParsedMasterPlan;
  let mergePlan: AmendmentMergePlan;
  try {
    amendment = parseAmendment(opts.amendmentPath);
    const outcome = buildMergePlan({ existing, amendment, frontier, state });
    if (outcome.type === 'invalid') return { type: 'invalid', error: outcome.error };
    if (outcome.type === 'blocked') return { type: 'blocked', blocked: outcome.blocked };
    mergePlan = outcome.plan;
  } catch (err: unknown) {
    if (err instanceof ParseError) return { type: 'invalid', error: err.toDetail() };
    throw err;
  }

  const amendmentDocPath = toRelativeDocPath(opts.amendmentPath, projectDir);

  const planMerge = mergeAmendmentIntoPlan({
    projectDir,
    projectName,
    masterPlanPath,
    requirementsPath: resolveRequirementsPath(projectDir, projectName, state),
    masterPlanRaw,
    existing,
    amendment,
    amendmentDocFileName: path.basename(opts.amendmentPath),
    mergePlan,
    frontier,
    nowIso,
  });

  const amendedState = mergeAmendmentIntoState({
    state,
    existing,
    merged: planMerge.merged,
    mergePlan,
    projectDir,
    projectName,
    amendmentDocPath,
    nowIso,
  });

  commit({
    projectDir,
    statePath,
    stateBefore,
    writes: planMerge.writes,
    deletes: planMerge.deletes,
    state: amendedState,
  });

  return {
    type: 'applied',
    applied: {
      index: mergePlan.amendmentIndex,
      docPath: amendmentDocPath,
      applied: nowIso,
      addsPhases: mergePlan.addsPhases,
      addsTasks: mergePlan.addsTasks,
      revisesTasks: mergePlan.revisesTasks,
      dropsTasks: mergePlan.dropsTasks,
      dropsPhases: mergePlan.dropsPhases,
      renumbered: mergePlan.renumbered,
      reopened: mergePlan.reopens,
      clearedHalt: mergePlan.clearsHalt,
      wrote: [
        ...planMerge.writes.map(write => toRelativeDocPath(write.path, projectDir)),
        STATE_FILE,
      ],
      removed: planMerge.deletes.map(del => toRelativeDocPath(del.path, projectDir)),
    },
  };
}

// ── The commit ───────────────────────────────────────────────────────────────

interface CommitInput {
  projectDir: string;
  statePath: string;
  stateBefore: Buffer;
  writes: StagedWrite[];
  deletes: StagedDelete[];
  state: AmendableState;
}

/** A file the commit replaced, with the bytes it held beforehand. */
interface Replaced {
  path: string;
  contents: Buffer;
}

/**
 * A file the commit removed, with the bytes it held beforehand — `null` when the
 * path was already absent, which is a no-op rather than a failure: the
 * transaction's job is to leave the project as it found it, and an already-absent
 * file is already in that shape.
 */
interface Deleted {
  path: string;
  contents: Buffer | null;
}

/**
 * Land every staged document, remove every staged deletion, then write
 * `state.json`. On any failure the project directory is put back exactly as it
 * was found, so a half-landed amendment — including a half-landed drop — is
 * never a reachable state.
 */
function commit(input: CommitInput): void {
  const created: string[] = [];
  const replaced: Replaced[] = [];
  const deleted: Deleted[] = [];

  try {
    for (const write of input.writes) {
      fs.mkdirSync(path.dirname(write.path), { recursive: true });
      if (fs.existsSync(write.path)) replaced.push({ path: write.path, contents: fs.readFileSync(write.path) });
      else created.push(write.path);
      fs.writeFileSync(write.path, write.contents, 'utf-8');
    }
    for (const del of input.deletes) {
      if (!fs.existsSync(del.path)) {
        deleted.push({ path: del.path, contents: null });
        continue;
      }
      deleted.push({ path: del.path, contents: fs.readFileSync(del.path) });
      fs.rmSync(del.path);
    }
    writeState(input.projectDir, input.state);
  } catch (err: unknown) {
    const failures = restore(created, replaced, deleted, input.statePath, input.stateBefore);
    if (failures.length > 0) {
      throw new Error(
        `amendment apply: the commit failed (${messageOf(err)}) AND the project could not be fully restored — ` +
          `${failures.join('; ')}. Inspect ${input.projectDir} before retrying.`,
      );
    }
    throw new Error(`amendment apply: the commit failed and the project was left unchanged: ${messageOf(err)}`);
  }
}

/**
 * The exploder's atomic state write: a sibling tmp file renamed over `state.json`,
 * removed again if either step fails.
 */
function writeState(projectDir: string, state: AmendableState): void {
  const statePath = path.join(projectDir, STATE_FILE);
  const tmpPath = path.join(projectDir, STATE_TMP_FILE);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

/**
 * Undo whatever the commit managed to land. Every step is attempted even when an
 * earlier one fails — leaving more of the project restored is strictly better —
 * and what could not be put back is reported. A deletion whose target was already
 * absent before the commit put nothing back, so restoring it means leaving it
 * absent, not attempting a write.
 */
function restore(
  created: string[],
  replaced: Replaced[],
  deleted: Deleted[],
  statePath: string,
  stateBefore: Buffer,
): string[] {
  const failures: string[] = [];
  const attempt = (what: string, action: () => void): void => {
    try {
      action();
    } catch (err: unknown) {
      failures.push(`${what}: ${messageOf(err)}`);
    }
  };

  for (const target of created) {
    attempt(`could not remove ${target}`, () => fs.rmSync(target, { force: true }));
  }
  for (const target of replaced) {
    attempt(`could not restore ${target.path}`, () => fs.writeFileSync(target.path, target.contents));
  }
  for (const target of deleted) {
    if (target.contents === null) continue;
    const contents = target.contents;
    attempt(`could not restore ${target.path}`, () => {
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(target.path, contents);
    });
  }
  attempt(`could not restore ${statePath}`, () => fs.writeFileSync(statePath, stateBefore));
  return failures;
}

// ── Project reads ────────────────────────────────────────────────────────────

function readFileOr(target: string, what: string): Buffer {
  try {
    return fs.readFileSync(target);
  } catch (err: unknown) {
    throw new Error(`amendment apply: could not read ${what} at ${target}: ${messageOf(err)}`);
  }
}

function resolveMasterPlanPath(projectDir: string, state: AmendableState): string {
  const docPath = state.graph?.nodes?.['master_plan']?.doc_path;
  if (typeof docPath !== 'string' || docPath.length === 0) {
    throw new Error(
      `amendment apply: no Master Plan recorded at graph.nodes.master_plan.doc_path in ` +
        `${path.join(projectDir, STATE_FILE)} — there is nothing to amend`,
    );
  }
  return path.isAbsolute(docPath) ? docPath : path.join(projectDir, docPath);
}

/**
 * The Requirements doc the amendment's record is appended to. The planning step
 * records where it wrote it; the naming convention is the fallback for a project
 * whose requirements step never ran under a doc_path.
 */
function resolveRequirementsPath(projectDir: string, projectName: string, state: AmendableState): string {
  const docPath = state.graph?.nodes?.['requirements']?.doc_path;
  if (typeof docPath === 'string' && docPath.length > 0) {
    return path.isAbsolute(docPath) ? docPath : path.join(projectDir, docPath);
  }
  return path.join(projectDir, `${projectName}-REQUIREMENTS.md`);
}

/** Shared with `commands/amendment/validate.ts` — both verbs need the same fallback. */
export function resolveProjectName(projectDir: string, state: PipelineState): string {
  const name = state.project?.name;
  return typeof name === 'string' && name.length > 0 ? name : path.basename(projectDir);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
