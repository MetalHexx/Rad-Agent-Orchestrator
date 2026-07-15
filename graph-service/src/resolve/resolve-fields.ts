// graph-service/src/resolve/resolve-fields.ts
//
// The generic field resolver. It reads a node type's `dataSchema` declarations and fills every
// field carrying a `resolve` hint with fresh, absolute paths — knowing nothing about which node
// type it is serving (D24: node-blindness). Dispatch is over the `resolve` axis alone, never over a
// concrete field name. The old stack resolved these fields per-action with hard-coded names; this
// does it once, generically, so a custom node with novel field names resolves through the same path.
import path from 'node:path';
import type { DataResolver, DataSchema } from '@rad-orchestration/graph-engine';
import type { WorktreeRecord } from '@rad-orchestration/graph-store-sqlite';
import { resolveWithinRoot } from '../capabilities/real.js';

export interface FieldResolverDeps {
  /** `<radorcRoot>/projects/<projectId>` — the root a project-relative doc path joins against, and the confinement boundary. */
  readonly projectDocRoot: string;
  /** `<radorcRoot>/worktrees` — the root a worktree ref joins against. */
  readonly worktreesRoot: string;
  /** This project's worktree records, read once per request. */
  readonly worktrees: readonly WorktreeRecord[];
  /** The project id, for the conventional fallback derivation. */
  readonly projectId: string;
}

type ResolveOutcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string };

/**
 * Builds a node-blind `DataResolver` over the two roots and worktree records supplied by the host.
 * Derives neither root internally: this module reads no environment, no home directory, no cwd, so
 * resolution is a pure function of its inputs — same node data + same worktree map → same paths.
 * Throws (naming the field) when a declared, required field cannot be resolved; the caller must not
 * swallow it.
 */
export function createFieldResolver(deps: FieldResolverDeps): DataResolver {
  const recordsByRepo = new Map<string, WorktreeRecord>();
  for (const record of deps.worktrees) recordsByRepo.set(record.repo, record);

  return (schema: DataSchema, data: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
    const result: Record<string, unknown> = { ...data };

    for (const [field, spec] of Object.entries(schema)) {
      // D24: dispatch on the declaration's `resolve` axis alone — never the field name. A field
      // with no hint is left exactly as it arrived (including a repo-shaped one that declares none).
      if (spec.resolve === undefined) continue;

      if (!Object.prototype.hasOwnProperty.call(data, field)) {
        // An absent field is never introduced. A required one that is absent cannot resolve at all
        // → fail loud; an optional/computed one that is absent is fine.
        if (spec.level === 'required') {
          throw guardError(field, 'field is absent from node data');
        }
        continue;
      }

      let outcome: ResolveOutcome;
      if (spec.resolve === 'worktree-repo-set') {
        outcome = resolveWorktreeRepoSet(data[field], deps, recordsByRepo);
      } else if (spec.resolve === 'project-doc-path') {
        outcome = resolveProjectDocPath(data[field], deps.projectDocRoot);
      } else {
        // A resolve hint the vocabulary added without teaching this module how to fill it — refuse
        // rather than silently pass a would-be-resolved field through unresolved.
        outcome = { ok: false, reason: `unknown resolve hint '${String(spec.resolve)}'` };
      }

      if (!outcome.ok) {
        throw guardError(field, outcome.reason);
      }
      result[field] = outcome.value;
    }

    return result;
  };
}

/**
 * Fills each repo entry's `path` with a fresh absolute path, looking the record up by repo name
 * (the entry's key is `name`, the record's is `repo` — mapped explicitly). Every other field on the
 * entry (`branch`, level-specific SHAs) is carried through untouched. A repo with no record at all
 * is refused, not conventionalized — that is source control never initialized for it.
 */
function resolveWorktreeRepoSet(
  value: unknown,
  deps: FieldResolverDeps,
  recordsByRepo: ReadonlyMap<string, WorktreeRecord>,
): ResolveOutcome {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'expected an array of repo entries' };
  }

  const resolved: unknown[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') {
      return { ok: false, reason: 'a repo entry is not an object' };
    }
    const repoName = (entry as Record<string, unknown>).name;
    if (typeof repoName !== 'string') {
      return { ok: false, reason: 'a repo entry is missing a string name' };
    }

    const record = recordsByRepo.get(repoName);
    if (record === undefined) {
      return { ok: false, reason: `no worktree record for repo '${repoName}' (source control never initialized for it)` };
    }

    // AD-2: the absolute path is derived here, never read from storage as an absolute. A set
    // `record.path` is a relative, POSIX-separated ref and is authoritative; a null one falls back
    // to the conventional join. Both are joined against the local worktrees root, not stored.
    const absolutePath = record.path !== null
      ? path.resolve(deps.worktreesRoot, record.path)
      : path.resolve(deps.worktreesRoot, deps.projectId, repoName);

    resolved.push({ ...(entry as Record<string, unknown>), path: absolutePath });
  }

  return { ok: true, value: resolved };
}

/**
 * Resolves a doc path (a string, or an array of strings resolved element-wise with order preserved)
 * relative→absolute against `projectDocRoot`, then confines it: a path that escapes the root is
 * refused. Deliberately stricter than the oracle's normalize-only helper — confinement is a real
 * behavior change this iteration's requirements call for. Non-string values pass through unchanged.
 */
function resolveProjectDocPath(value: unknown, projectDocRoot: string): ResolveOutcome {
  if (typeof value === 'string') {
    const resolved = resolveWithinRoot(projectDocRoot, value);
    if (resolved === null) {
      return { ok: false, reason: `doc path '${value}' escapes the project doc root` };
    }
    return { ok: true, value: resolved };
  }

  if (Array.isArray(value)) {
    const resolved: unknown[] = [];
    for (const element of value) {
      if (typeof element !== 'string') {
        resolved.push(element);
        continue;
      }
      const abs = resolveWithinRoot(projectDocRoot, element);
      if (abs === null) {
        return { ok: false, reason: `doc path '${element}' escapes the project doc root` };
      }
      resolved.push(abs);
    }
    return { ok: true, value: resolved };
  }

  // A non-string, non-array value (e.g. null) passes through unchanged — parity with the oracle,
  // which normalizes rather than validates the value's type.
  return { ok: true, value };
}

/**
 * The message an operator reads at 2am: name the field and say what was missing. Node-blind — the
 * `DataResolver` contract carries no node type name, and this package must not name one.
 */
function guardError(field: string, reason: string): Error {
  return new Error(`cannot resolve required field '${field}': ${reason}`);
}
