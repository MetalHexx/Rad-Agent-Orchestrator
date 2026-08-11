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
import { PROJECT_DIR, TEST_PATH_CONTEXT, seedDoc } from './fixtures/parity-states.js';
import {
  driveTwoRepoTaskCorrective,
  activeCorrective,
  driveTwoRepoFinalCorrective,
  activeFinalCorrective,
  originalTaskIteration,
} from './fixtures/corrective-helpers.js';

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

// ── Final-scope write destination (P01-T03) ──────────────────────────────────
//
// Asserts *where* a task_completed/code_review_completed signal writes during
// an open final-scope corrective — the defect being fixed is a successful
// write to the wrong host (the completed task iteration), so these check the
// destination on both sides: the corrective gains the write, and the original
// task iteration's repos stay byte-identical.

describe('final-scope write destination (task_completed, code_review_completed)', () => {
  it('task_completed during an open final corrective writes task_executor and per-repo hashes onto the corrective, not the completed task iteration', () => {
    const io = driveTwoRepoFinalCorrective();
    const before = originalTaskIteration(io, 1, 1);
    const beforeRepos = structuredClone(before.repos);

    const result = processEvent('task_completed', PROJECT_DIR, {
      branch: 'radorch/p',
      repos: [
        { name: 'fake-api', committed: true, commitHash: 'finalapi1', pushed: true },
        { name: 'fake-ui', committed: true, commitHash: 'finalui1', pushed: true },
      ],
    }, io, TEST_PATH_CONTEXT);

    expect(result.error).toBeUndefined();

    const corrective = activeFinalCorrective(io);
    expect(corrective.nodes['task_executor'].status).toBe('completed');
    expect(corrective.repos.find(r => r.name === 'fake-api')!.commit_hash).toBe('finalapi1');
    expect(corrective.repos.find(r => r.name === 'fake-ui')!.commit_hash).toBe('finalui1');

    // The write did not land on the original (completed) task iteration.
    const after = originalTaskIteration(io, 1, 1);
    expect(after.repos).toEqual(beforeRepos);
  });

  it('a commit reported off the sealed task branch is refused at final scope', () => {
    const io = driveTwoRepoFinalCorrective();
    const result = processEvent('task_completed', PROJECT_DIR, {
      branch: 'some-other-branch',
      repos: [
        { name: 'fake-api', committed: true, commitHash: 'finalapi1', pushed: true },
        { name: 'fake-ui', committed: true, commitHash: 'finalui1', pushed: true },
      ],
    }, io, TEST_PATH_CONTEXT);

    expect(result.error).toBeDefined();
    expect(result.error!.message).toMatch(/task_completed refused/i);

    const corrective = activeFinalCorrective(io);
    expect(corrective.repos).toEqual([]);
  });

  it('code_review_completed during the same corrective resolves the corrective\'s own code_review node, not a phase/task node', () => {
    const io = driveTwoRepoFinalCorrective();
    processEvent('task_completed', PROJECT_DIR, {
      branch: 'radorch/p',
      repos: [
        { name: 'fake-api', committed: true, commitHash: 'finalapi1', pushed: true },
        { name: 'fake-ui', committed: true, commitHash: 'finalui1', pushed: true },
      ],
    }, io, TEST_PATH_CONTEXT);

    const reviewDoc = PROJECT_DIR + '/final-corrective-review.md';
    seedDoc(reviewDoc);
    const result = processEvent('code_review_completed', PROJECT_DIR, {
      doc_path: reviewDoc,
      verdict: 'approved',
    }, io, TEST_PATH_CONTEXT);

    expect(result.error).toBeUndefined();

    const corrective = activeFinalCorrective(io);
    expect(corrective.nodes['code_review'].status).toBe('completed');
    expect((corrective.nodes['code_review'] as { verdict?: string | null }).verdict).toBe('approved');
  });
});
