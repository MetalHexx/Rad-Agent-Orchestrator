// graph-service/tests/fixtures/repos.ts
//
// The one repo target every fixture below seeds — mirrors the shape `lib/graph-node-types`'s own
// integration fixtures use (`tests/integration/*.test.ts`'s `REPOS`/`taskData`), reused here
// verbatim rather than re-invented. Carries no `path` of its own: a `worktree-repo-set` field's
// `path` is filled fresh by the generic field resolver (`resolve/resolve-fields.ts`) off a real
// `WorktreeRecord` — seed one via `harness/drive.ts`'s `addWorktree` for any project that will
// actually engage a node naming this repo, never a stored absolute path here.
export const FIXTURE_REPO = {
  name: 'rad-orc-source',
  branch: 'radorch/STEERABLE-DAG-2.3',
} as const;

export const FIXTURE_PR_REPO = { ...FIXTURE_REPO, base_branch: 'main' } as const;

/** A `rad-orc:task`/`rad-orc:corrective` node's own required scope contract, seeded at
 * `handoffDocPath` — a project-relative path, confined and made absolute by the resolver. */
export function taskData(handoffDocPath: string): Readonly<Record<string, unknown>> {
  return {
    handoffDocPath,
    repos: [FIXTURE_REPO],
    complexity: 'standard' as const,
    shouldCommit: true,
  };
}
