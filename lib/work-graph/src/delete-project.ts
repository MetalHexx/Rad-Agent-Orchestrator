import fs from 'node:fs';
import path from 'node:path';
import type { NodeId, Result, WorktreeRef, Edge } from './types.js';
import { resolveWorktrees, defaultExec, type GitExec } from './derive/worktrees.js';
import type { GraphIndex } from './store.js';

// ---------------------------------------------------------------------------
// Public contract — pinned exactly; downstream CLI and API-route consumers
// build against these names and shapes.
// ---------------------------------------------------------------------------

export type DeletionItemKind =
  | 'project-dir'        // ~/.radorc/projects/<name>/
  | 'worktree'           // ~/.radorc/worktrees/<worktree_name>/<repo>/
  | 'side-project-repo'  // ~/.radorc/side-projects/<name>/
  | 'graph-edges';       // the project's edges in ~/.radorc/work-graph.yml

export type DeletionDisposition = 'remove' | 'protected';
export type DeletionOutcome =
  | 'removed'
  | 'already-absent'
  | 'protected'
  | 'skipped'      // deliberately kept by the caller — not a failure
  | 'failed'
  | 'held-back';   // deliberately not attempted, so the project stays reachable

export interface DeletionItem {
  kind: DeletionItemKind;
  /** Display label: the repo name for a worktree, the project name otherwise. */
  label: string;
  /** Absolute path, or null for 'graph-edges' — it is not a filesystem object. */
  path: string | null;
  /** Filesystem existence — `fs.existsSync(path)`. Deliberately NOT `WorktreeRef.exists`,
   *  which answers "does git list this worktree?", not "is there a directory here?". */
  exists: boolean;
  disposition: DeletionDisposition;
  /** Present only when disposition is 'protected'. */
  protectedReason?: string;
}

export interface DeletionPlan {
  project: string;
  items: DeletionItem[];
}

export interface DeletionItemResult extends DeletionItem {
  outcome: DeletionOutcome;
  /** The reason — present when outcome is 'failed' or 'held-back'. */
  error?: string;
}

export interface DeletionReport {
  project: string;
  items: DeletionItemResult[];
  /** True when no item's outcome is 'failed' or 'held-back'. */
  complete: boolean;
}

/**
 * A caller-supplied item to keep rather than remove. Keyed on kind + label,
 * not path — a path round-trips through an HTTP boundary that rewrites it for
 * display, and kind + label is already unique in a plan (a `worktree` item's
 * label is its repo name, a `side-project-repo` item's is the project id).
 */
export interface DeletionSkip {
  kind: DeletionItemKind;
  label: string;
}

/** The composed deps `WorkGraphService` already produces for its other derive calls, plus the store. */
export interface DeletionDeps {
  projectsDir: string;
  worktreesDir: string;
  sideProjectsDir: string;
  registryLocalPaths: Record<string, string>;
  exec?: GitExec;
  index: GraphIndex;
}

// ---------------------------------------------------------------------------
// Safety seam — name validation, containment, symlink-escape refusal
// ---------------------------------------------------------------------------

function validateProjectName(id: NodeId): { code: 'validation'; message: string } | null {
  if (!id || !id.trim() || id === '.' || id === '..' || id.includes('/') || id.includes('\\') ||
      path.isAbsolute(id) || path.basename(id) !== id) {
    return { code: 'validation', message: `invalid project id: '${id}'` };
  }
  return null;
}

/** True when `target` is `root` itself or nested under it. */
function isContained(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Name validation (no filesystem access), containment of the resolved project
 * directory under `projectsDir`, and — only when the directory exists — a
 * symlink-escape re-check against the real path. Shared by both public entry
 * points so neither can construct a call that bypasses these guards.
 */
function validateAndResolve(projectId: NodeId, deps: DeletionDeps): Result<string> {
  const nameError = validateProjectName(projectId);
  if (nameError) return { ok: false, error: nameError };
  const projectDir = path.join(deps.projectsDir, projectId);
  if (!isContained(deps.projectsDir, projectDir)) {
    return { ok: false, error: { code: 'validation', message: `project id resolves outside the projects directory: '${projectId}'` } };
  }
  if (fs.existsSync(projectDir)) {
    // A project-directory symlink is rejected outright, even when its target is a
    // sibling still inside `projectsDir` (an alias). Without this, `ALIAS -> VICTIM`
    // would pass the containment check below (VICTIM is inside projectsDir too),
    // buildPlan would read ALIAS/state.json — which the OS transparently resolves to
    // VICTIM's real file — and derive VICTIM's real worktrees for genuine removal,
    // while the final `removeFsItem` on 'project-dir' unlinks only ALIAS (fs.rmSync
    // does not dereference a symlink for removal), so the report would claim "ALIAS
    // deleted" while VICTIM's data is actually gone.
    if (fs.lstatSync(projectDir).isSymbolicLink()) {
      return { ok: false, error: { code: 'validation', message: `project directory '${projectId}' is a symlink; refusing to operate on it` } };
    }
    // Defense in depth: a symlink buried deeper in the path (e.g. `projectsDir`
    // itself reached through a symlinked ancestor) than the direct alias case above.
    const realRoot = fs.realpathSync.native(deps.projectsDir);
    const realDir = fs.realpathSync.native(projectDir);
    if (!isContained(realRoot, realDir)) {
      return { ok: false, error: { code: 'validation', message: `project directory '${projectId}' is a symlink escaping the projects directory` } };
    }
  }
  return { ok: true, data: projectDir };
}

// ---------------------------------------------------------------------------
// Plan composition
// ---------------------------------------------------------------------------

function worktreeItem(ref: WorktreeRef, projectId: NodeId, deps: DeletionDeps): DeletionItem {
  const exists = fs.existsSync(ref.path);
  const kind: DeletionItemKind = isContained(deps.sideProjectsDir, ref.path) ? 'side-project-repo' : 'worktree';
  const label = kind === 'worktree' ? ref.repo : projectId;
  if (ref.resolvedVia === 'registry-clone') {
    return {
      kind, label, path: ref.path, exists, disposition: 'protected',
      protectedReason: `'${ref.repo}' is the user's registered clone at ${ref.path}; it is never removed`,
    };
  }
  return { kind, label, path: ref.path, exists, disposition: 'remove' };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deletion-path-local strictness layer over `resolveWorktrees`. That derive helper
 * deliberately returns `[]` both when `state.json` is legitimately absent AND when
 * it exists but is malformed JSON or has a non-object `pipeline`/`pipeline.source_control`
 * — a lenient contract other read-only consumers (locate, session-context, `project
 * worktrees`) rely on, so it is never changed here. The deletion path cannot afford
 * that leniency: treating "malformed" the same as "nothing to resolve" would let
 * buildPlan proceed to delete the project directory (including state.json itself),
 * silently stranding worktrees/side-project repos with no metadata left to
 * rediscover them on retry. This helper adds that strictness locally:
 * - `state.json` absent → `[]` (preserves existing resumability — an
 *   already-fully-deleted project's second delete pass must still find nothing).
 * - `state.json` present but fails to parse, or `pipeline`/`pipeline.source_control`
 *   is present but not a plain object → `ok:false`, refusing the whole plan.
 * - `pipeline.source_control` simply absent (no `pipeline` block yet — a legitimate
 *   not-yet-executed project) → still legitimate; delegates to `resolveWorktrees`.
 * - Otherwise delegates to `resolveWorktrees`, wrapped `ok:true`.
 * Independently of how state.json parses, a `sideProjectsDir/<id>` directory found
 * on disk is always folded in as a synthetic ref — its presence in the plan must
 * not depend on state.json correctly labelling the project as a side-project.
 */
function resolveDeletionRefs(projectId: NodeId, deps: DeletionDeps): Result<WorktreeRef[]> {
  const statePath = path.join(deps.projectsDir, projectId, 'state.json');
  let refs: WorktreeRef[] = [];

  if (fs.existsSync(statePath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      return { ok: false, error: { code: 'validation', message: `project '${projectId}'s state.json is not valid JSON — refusing to delete until it is repaired or removed manually` } };
    }
    const root: Record<string, unknown> = isPlainObject(parsed) ? parsed : {};
    const pipeline = root.pipeline;
    if (pipeline !== undefined && !isPlainObject(pipeline)) {
      return { ok: false, error: { code: 'validation', message: `project '${projectId}'s state.json has a malformed 'pipeline' field — refusing to delete until it is repaired or removed manually` } };
    }
    const sourceControl = isPlainObject(pipeline) ? pipeline.source_control : undefined;
    if (sourceControl !== undefined && !isPlainObject(sourceControl)) {
      return { ok: false, error: { code: 'validation', message: `project '${projectId}'s state.json has a malformed 'pipeline.source_control' field — refusing to delete until it is repaired or removed manually` } };
    }
    refs = resolveWorktrees(projectId, {
      projectsDir: deps.projectsDir,
      worktreesDir: deps.worktreesDir,
      sideProjectsDir: deps.sideProjectsDir,
      registryLocalPaths: deps.registryLocalPaths,
      exec: deps.exec,
    });
  }

  const sideProjectPath = path.join(deps.sideProjectsDir, projectId);
  if (fs.existsSync(sideProjectPath)) {
    const resolvedSidePath = path.resolve(sideProjectPath);
    const alreadyResolved = refs.some((ref) => path.resolve(ref.path) === resolvedSidePath);
    if (!alreadyResolved) {
      refs = [...refs, { repo: projectId, path: sideProjectPath, branch: null, exists: true, resolvedVia: 'convention' }];
    }
  }

  return { ok: true, data: refs };
}

/**
 * Fails the whole plan closed if any resolved ref's path was steered outside its
 * expected location by attacker-controlled state.json fields (`worktree_name`, a
 * repo name, or a legacy absolute `worktree_path`) — e.g. `worktree_name:
 * '../side-projects'` making an ordinary project's worktree resolve inside
 * `sideProjectsDir`, get misclassified `side-project-repo`, and get recursively
 * `fs.rmSync`'d with no git safety net. A `registry-clone` ref is exempt — it is
 * the operator's own registered clone, already protected and never removed.
 * Every other ref must land inside `worktreesDir` (reusing the same `isContained`
 * check `worktreeItem` uses to classify it), except the one ref that would be
 * classified `side-project-repo` — that one must equal the project's own
 * conventional side-project path exactly, not merely be contained within
 * `sideProjectsDir`. A violation fails the whole plan rather than holding back a
 * single item — there is no disposition/outcome value for "quarantined", and
 * inventing one would render invisibly in the UI dialog, which only branches on
 * the existing closed set.
 */
function validateRefContainment(projectId: NodeId, refs: WorktreeRef[], deps: DeletionDeps): { code: 'validation'; message: string } | null {
  const expectedSidePath = path.resolve(deps.sideProjectsDir, projectId);
  for (const ref of refs) {
    if (ref.resolvedVia === 'registry-clone') continue;
    const wouldBeSideProject = isContained(deps.sideProjectsDir, ref.path);
    const contained = wouldBeSideProject
      ? path.resolve(ref.path) === expectedSidePath
      : isContained(deps.worktreesDir, ref.path);
    if (!contained) {
      return { code: 'validation', message: `project '${projectId}'s state.json resolves a path outside its expected location (${ref.path}) — refusing to delete` };
    }
  }
  return null;
}

/**
 * Composes the plan in execution order: worktrees first (resolveDeletionRefs reads
 * state.json from inside the project directory, so it must run before that
 * directory is gone), then the project directory, then the graph-edges entry.
 * Fallible: a malformed state.json or a containment violation fails the whole
 * plan closed rather than proceeding with a partial or misclassified picture.
 */
function buildPlan(projectId: NodeId, projectDir: string, deps: DeletionDeps): Result<DeletionPlan> {
  const refsResult = resolveDeletionRefs(projectId, deps);
  if (!refsResult.ok) return refsResult;
  const refs = refsResult.data;

  const containmentError = validateRefContainment(projectId, refs, deps);
  if (containmentError) return { ok: false, error: containmentError };

  const items: DeletionItem[] = refs.map((ref) => worktreeItem(ref, projectId, deps));
  items.push({ kind: 'project-dir', label: projectId, path: projectDir, exists: fs.existsSync(projectDir), disposition: 'remove' });
  const stored = deps.index.read();
  const hasEdges = stored.edges.some((e: Edge) => e.from === projectId || e.to === projectId);
  items.push({ kind: 'graph-edges', label: projectId, path: null, exists: hasEdges, disposition: 'remove' });
  return { ok: true, data: { project: projectId, items } };
}

/**
 * Preview: "what would deleting this project remove?" Touches nothing on disk.
 * Rejects an unrecognised project id — a project that currently has no directory
 * on disk — with a validation error naming it, so a preview caller gets a clear
 * signal rather than an all-absent plan. `deleteProject` does not repeat this
 * gate: an already-fully-deleted project is a legitimate resumable target, not
 * an error (see the resumability rule below).
 */
export function planProjectDeletion(projectId: NodeId, deps: DeletionDeps): Result<DeletionPlan> {
  const resolved = validateAndResolve(projectId, deps);
  if (!resolved.ok) return resolved;
  const projectDir = resolved.data;
  if (!fs.existsSync(projectDir)) {
    return { ok: false, error: { code: 'validation', message: `project '${projectId}' does not exist` } };
  }
  return buildPlan(projectId, projectDir, deps);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Clone resolution: the registry's local path when present, else the worktree's own git-common-dir. */
function resolveClonePath(repo: string, worktreePath: string, exec: GitExec, deps: DeletionDeps): string | null {
  const registryPath = deps.registryLocalPaths[repo];
  if (registryPath) return registryPath;
  try {
    const out = exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: worktreePath });
    return path.dirname(out.trim());
  } catch {
    return null;
  }
}

/** Mirrors `fs.rmSync`'s `maxRetries`/`retryDelay` defaults (line ~259 below) so a
 *  worktree still open in an editor, or briefly locked by an AV scan, gets the
 *  same brief retry window a project-dir or side-project-repo removal already gets. */
const WORKTREE_REMOVE_MAX_RETRIES = 5;
const WORKTREE_REMOVE_RETRY_DELAY_MS = 100;

/**
 * Worktree removal goes through git, never a recursive delete — that would leave
 * stale bookkeeping in <clone>/.git/worktrees/. The absence check comes first and
 * wins: a missing worktree is always already-absent, even when its clone cannot
 * be resolved, so the operation stays resumable.
 */
function removeWorktreeItem(item: DeletionItem, exec: GitExec, deps: DeletionDeps, sleep: (ms: number) => void): DeletionItemResult {
  const worktreePath = item.path as string;
  if (!item.exists) {
    try {
      const clonePath = resolveClonePath(item.label, worktreePath, exec, deps);
      if (clonePath) exec('git', ['worktree', 'prune'], { cwd: clonePath });
    } catch {
      // Best-effort bookkeeping cleanup only — a missing worktree is always already-absent.
    }
    return { ...item, outcome: 'already-absent' };
  }
  const clonePath = resolveClonePath(item.label, worktreePath, exec, deps);
  if (!clonePath) {
    return { ...item, outcome: 'failed', error: `no clone found for repo '${item.label}'` };
  }
  let lastError: unknown;
  for (let attempt = 0; attempt <= WORKTREE_REMOVE_MAX_RETRIES; attempt++) {
    try {
      exec('git', ['worktree', 'remove', '--force', worktreePath], { cwd: clonePath });
      return { ...item, outcome: 'removed' };
    } catch (e) {
      lastError = e;
      if (attempt < WORKTREE_REMOVE_MAX_RETRIES) sleep(WORKTREE_REMOVE_RETRY_DELAY_MS);
    }
  }
  return { ...item, outcome: 'failed', error: lastError instanceof Error ? lastError.message : String(lastError) };
}

/** Plain recursive removal for the project directory and a side project's own repository. */
function removeFsItem(item: DeletionItem, rm: (target: string) => void): DeletionItemResult {
  if (!item.exists) return { ...item, outcome: 'already-absent' };
  rm(item.path as string);
  return { ...item, outcome: 'removed' };
}

/** Mirrors `deleteGroup`'s edge cascade: filter the store and write with the read revision. */
function removeGraphEdgesItem(item: DeletionItem, projectId: NodeId, deps: DeletionDeps): DeletionItemResult {
  if (!item.exists) return { ...item, outcome: 'already-absent' };
  const stored = deps.index.read();
  stored.edges = stored.edges.filter((e: Edge) => e.from !== projectId && e.to !== projectId);
  const written = deps.index.write(stored, stored.rev);
  if (!written.ok) return { ...item, outcome: 'failed', error: written.error.message };
  return { ...item, outcome: 'removed' };
}

function defaultRm(target: string): void {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Blocking sleep — the whole call chain here is synchronous (execFileSync, fs.*Sync),
 *  so a retry delay between attempts needs a real block rather than a Promise. */
function defaultSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Computes the plan itself (a caller never passes a plan back in — the dashboard
 * cannot execute a stale preview) and carries it out item by item. Every item is
 * attempted inside its own try/catch, so one failure never short-circuits the
 * rest. The project directory is removed last, and only if every worktree and
 * side-project item ahead of it succeeded — state.json lives inside it, and every
 * worktree path is derived from that file, so removing it early would strand a
 * partially-deleted workspace with nothing left pointing at it. The graph-edges
 * item is held back under the same condition.
 */
export function deleteProject(
  projectId: NodeId,
  deps: DeletionDeps,
  opts?: { rm?: (path: string) => void; sleep?: (ms: number) => void; skip?: DeletionSkip[] },
): Result<DeletionReport> {
  const resolved = validateAndResolve(projectId, deps);
  if (!resolved.ok) return resolved;
  const projectDir = resolved.data;
  const planResult = buildPlan(projectId, projectDir, deps);
  if (!planResult.ok) return planResult;
  const plan = planResult.data;
  const exec = deps.exec ?? defaultExec;
  const rm = opts?.rm ?? defaultRm;
  const sleep = opts?.sleep ?? defaultSleep;
  const skip = opts?.skip ?? [];

  const results: DeletionItemResult[] = [];
  let blockedBy: string | null = null;

  for (const item of plan.items) {
    let result: DeletionItemResult;
    try {
      // A skip is only honoured for a removable worktree/side-project-repo item;
      // 'project-dir' and 'graph-edges' are structurally mandatory (the project
      // directory holds state.json, from which every worktree path is derived,
      // so it must always go regardless of what a worktree skip leaves behind),
      // and a 'protected' item already wins on its own.
      const isSkipped = item.disposition === 'remove' &&
        (item.kind === 'worktree' || item.kind === 'side-project-repo') &&
        skip.some((s) => s.kind === item.kind && s.label === item.label);
      if (item.disposition === 'protected') {
        result = { ...item, outcome: 'protected' };
      } else if (isSkipped) {
        result = { ...item, outcome: 'skipped' };
      } else if (item.kind === 'worktree') {
        result = removeWorktreeItem(item, exec, deps, sleep);
      } else if (item.kind === 'side-project-repo') {
        result = removeFsItem(item, rm);
      } else if (item.kind === 'project-dir') {
        result = blockedBy
          ? { ...item, outcome: 'held-back', error: `blocked by ${blockedBy}` }
          : removeFsItem(item, rm);
      } else {
        result = blockedBy
          ? { ...item, outcome: 'held-back', error: `blocked by ${blockedBy}` }
          : removeGraphEdgesItem(item, projectId, deps);
      }
    } catch (e) {
      result = { ...item, outcome: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
    results.push(result);
    if (!blockedBy && result.outcome === 'failed' && (item.kind === 'worktree' || item.kind === 'side-project-repo')) {
      blockedBy = `${item.kind === 'side-project-repo' ? 'side project repo' : 'worktree'} '${item.label}'`;
    }
  }

  const complete = results.every((r) => r.outcome !== 'failed' && r.outcome !== 'held-back');
  return { ok: true, data: { project: projectId, items: results, complete } };
}
