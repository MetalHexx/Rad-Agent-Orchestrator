// graph-service/tests/fixtures/repos.ts
//
// The one repo target every fixture below seeds — mirrors the shape `lib/graph-node-types`'s own
// integration fixtures use (`tests/integration/*.test.ts`'s `REPOS`/`taskData`), reused here
// verbatim rather than re-invented.
export const FIXTURE_REPO = {
  name: 'rad-orc-source',
  path: '/repos/rad-orc-source',
  branch: 'radorch/STEERABLE-DAG-1',
} as const;

export const FIXTURE_PR_REPO = { ...FIXTURE_REPO, base_branch: 'main' } as const;

/** A `rad-orc:task`/`rad-orc:corrective` node's own required scope contract, seeded at `handoffDocPath`. */
export function taskData(handoffDocPath: string): Readonly<Record<string, unknown>> {
  return {
    handoffDocPath,
    repos: [FIXTURE_REPO],
    complexity: 'standard' as const,
    shouldCommit: true,
  };
}
