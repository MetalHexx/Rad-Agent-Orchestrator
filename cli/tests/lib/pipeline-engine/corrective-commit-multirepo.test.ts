// cli/tests/lib/pipeline-engine/corrective-commit-multirepo.test.ts
//
// Integration test: multi-repo corrective commit — create-or-match-by-name (FR-7, NFR-6).
//
// Asserts that a `task_completed` signal with a two-repo array writes each
// commit hash to the matching corrective `repos[]` entry by name. The corrective
// starts with `repos: []` (born from a `code_review_completed` with
// `changes_requested`), so the create-or-match-by-name path is exercised
// across the corrective site.
//
// FR-7: per-repo commit hash tracking.
// FR-20: v6 shape — no compat mirror fields.
// NFR-6: corrective entries must track per-repo commit hashes.
import { describe, it, expect } from 'vitest';
import { processEvent } from '../../../src/lib/pipeline-engine/engine.js';
import { PROJECT_DIR, TEST_PATH_CONTEXT } from './fixtures/parity-states.js';
import { driveTwoRepoTaskCorrective, activeCorrective } from './fixtures/corrective-helpers.js';

describe('multi-repo corrective commit — create-or-match-by-name (FR-7, NFR-6)', () => {
  it('creates corrective repos[] from the signal array names', () => {
    const io = driveTwoRepoTaskCorrective();
    processEvent('task_completed', PROJECT_DIR, {
      phase: 1, task: 1,
      repos: [
        { name: 'fake-api', committed: true, commitHash: 'apifix1', pushed: true },
        { name: 'fake-ui', committed: true, commitHash: 'uifix1', pushed: true },
      ],
    }, io, TEST_PATH_CONTEXT);
    const corr = activeCorrective(io, 1, 1);
    expect(corr.repos.find(r => r.name === 'fake-api')!.commit_hash).toBe('apifix1');
    expect(corr.repos.find(r => r.name === 'fake-ui')!.commit_hash).toBe('uifix1');
  });
});
