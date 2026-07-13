import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveDocPaths } from '../../../src/lib/pipeline-engine/resolve-doc-paths.js';

// Proves parity between the CLI-tier `resolveDocPaths` helper and the
// graph-service reviewer spawn payload shapes defined in
// `lib/graph-node-types/src/rad-orc/code-review.ts` (`CodeReviewSpawnBase`,
// `TaskCodeReviewSpawnPayload`, `PhaseCodeReviewSpawnPayload`,
// `FinalCodeReviewSpawnPayload`). Those interfaces are non-nullable
// (`review_report_path: string`, `handoff_doc: string`,
// `phase_plan_paths: readonly string[]`); the fixtures below are plain
// object literals of that field shape rather than imports of the types
// themselves, to avoid a test-only cross-package type dependency. The
// resolution rule under test — join-if-relative, leave-absolute-untouched,
// null/array element-wise identical — must hold for both this graph-service
// shape and the enrichment-layer shape T01 already covers
// (resolve-doc-paths.test.ts), because exactly one helper governs both
// systems.
//
// No `cli/src` file yet imports `@rad-orchestration/graph-service` to project
// a spawn payload into an outbound envelope, so there is no call site to wire
// `resolveDocPaths` into today. When the steerable-DAG CLI lands that call
// site, it applies this same helper at the emit point.

const PROJECT_DIR = path.resolve('/tmp/project-dir');

describe('resolveDocPaths — graph-service payload parity', () => {
  it('resolves a task-level reviewer spawn payload (relative handoff_doc + review_report_path)', () => {
    const payload = {
      kind: 'reviewer',
      level: 'task',
      review_report_path: 'tasks/reports/P01-T02.review.md',
      handoff_doc: 'tasks/ABS-DOC-PATHS-TASK-P01-T02.md',
      repos: [{ name: 'rad-orc-source', path: '/abs/rad-orc-source' }],
    };

    const result = resolveDocPaths(payload, PROJECT_DIR);

    expect(result.review_report_path).toBe(path.join(PROJECT_DIR, payload.review_report_path));
    expect(result.handoff_doc).toBe(path.join(PROJECT_DIR, payload.handoff_doc));
    expect(path.isAbsolute(result.review_report_path as string)).toBe(true);
    expect(path.isAbsolute(result.handoff_doc as string)).toBe(true);
    expect(result.repos).toEqual(payload.repos);
  });

  it('resolves a phase-level reviewer spawn payload (relative phase_plan_doc)', () => {
    const payload = {
      kind: 'reviewer',
      level: 'phase',
      review_report_path: 'phases/reports/P01.review.md',
      phase_plan_doc: 'phases/ABS-DOC-PATHS-PHASE-P01.md',
      repos: [{ name: 'rad-orc-source', path: '/abs/rad-orc-source' }],
    };

    const result = resolveDocPaths(payload, PROJECT_DIR);

    expect(result.review_report_path).toBe(path.join(PROJECT_DIR, payload.review_report_path));
    expect(result.phase_plan_doc).toBe(path.join(PROJECT_DIR, payload.phase_plan_doc));
  });

  it('resolves a final-level reviewer spawn payload (relative requirements_doc + phase_plan_paths array)', () => {
    const payload = {
      kind: 'reviewer',
      level: 'final',
      review_report_path: 'final/report.md',
      requirements_doc: 'requirements/ABS-DOC-PATHS-REQUIREMENTS.md',
      phase_plan_paths: ['phases/PHASE-P01.md', 'phases/PHASE-P02.md'],
      repos: [{ name: 'rad-orc-source', path: '/abs/rad-orc-source' }],
    };

    const result = resolveDocPaths(payload, PROJECT_DIR);

    expect(result.requirements_doc).toBe(path.join(PROJECT_DIR, payload.requirements_doc));
    expect(result.phase_plan_paths).toEqual([
      path.join(PROJECT_DIR, 'phases/PHASE-P01.md'),
      path.join(PROJECT_DIR, 'phases/PHASE-P02.md'),
    ]);
  });

  it('leaves an already-absolute doc-path field untouched', () => {
    const absoluteHandoffDoc = path.resolve('/elsewhere/ABS-DOC-PATHS-TASK-P01-T02.md');
    const payload = {
      kind: 'reviewer',
      level: 'task',
      review_report_path: 'tasks/reports/P01-T02.review.md',
      handoff_doc: absoluteHandoffDoc,
    };

    const result = resolveDocPaths(payload, PROJECT_DIR);

    expect(result.handoff_doc).toBe(absoluteHandoffDoc);
    expect(result.review_report_path).toBe(path.join(PROJECT_DIR, payload.review_report_path));
  });

  it('tolerates a null scalar and an array-with-null element even though graph-node-types fields are non-nullable', () => {
    // The service's own types never produce these, but the enrichment-layer
    // (T01) shapes are `string | null` and `(string | null)[]` — this pins
    // that the shared helper's contract is identical across both systems.
    const payload = {
      kind: 'reviewer',
      level: 'final',
      review_report_path: null,
      requirements_doc: 'requirements/ABS-DOC-PATHS-REQUIREMENTS.md',
      phase_plan_paths: ['phases/PHASE-P01.md', null],
    };

    const result = resolveDocPaths(payload, PROJECT_DIR);

    expect(result.review_report_path).toBeNull();
    expect(result.requirements_doc).toBe(path.join(PROJECT_DIR, payload.requirements_doc));
    expect(result.phase_plan_paths).toEqual([path.join(PROJECT_DIR, 'phases/PHASE-P01.md'), null]);
  });
});
