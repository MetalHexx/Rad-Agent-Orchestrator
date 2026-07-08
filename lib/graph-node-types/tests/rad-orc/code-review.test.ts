import { describe, expect, it } from 'vitest';
import {
  CODE_REVIEW_NODE_TYPE,
  CODE_REVIEW_REVIEWED_TOKEN,
  type FinalCodeReviewSpawnPayload,
  type PhaseCodeReviewSpawnPayload,
  type TaskCodeReviewSpawnPayload,
} from '../../src/rad-orc/code-review.js';
import {
  FINAL_REPO_SHA_FIXTURE,
  PHASE_REPO_SHA_FIXTURE,
  TASK_REPO_SHA_FIXTURE,
} from '../fixtures/frozen-contracts.js';

const REPO_BASE = { name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-1' };

describe('rad-orc:code_review', () => {
  it('declares the routes trait and doc-read/git-facts/spawn-agent capabilities', () => {
    expect(CODE_REVIEW_NODE_TYPE.name).toBe('rad-orc:code_review');
    expect(CODE_REVIEW_NODE_TYPE.traits).toEqual(['routes']);
    expect(CODE_REVIEW_NODE_TYPE.capabilities).toEqual(['doc-read', 'git-facts', 'spawn-agent']);
  });

  describe('act — the per-level SHA/doc seam', () => {
    it('task level carries exactly the frozen head_sha field, plus handoff_doc', () => {
      const result = CODE_REVIEW_NODE_TYPE.act({
        nodeId: 'review-task',
        data: {
          level: 'task',
          reviewReportPath: '/project/reviews/P04-T04.md',
          handoffDocPath: '/project/tasks/EXAMPLE-TASK-P04-T04.md',
          repos: [{ ...REPO_BASE, head_sha: TASK_REPO_SHA_FIXTURE.head_sha }],
        },
      });
      expect(result.executor).toBe('spawn-sub-agent');
      const payload = result.payload as TaskCodeReviewSpawnPayload;
      expect(payload.kind).toBe('reviewer');
      expect(payload.level).toBe('task');
      expect(payload.handoff_doc).toBe('/project/tasks/EXAMPLE-TASK-P04-T04.md');
      expect(payload.review_report_path).toBe('/project/reviews/P04-T04.md');
      const [repo] = payload.repos;
      expect(Object.keys(repo)).toEqual(['name', 'path', 'branch', ...Object.keys(TASK_REPO_SHA_FIXTURE)]);
      expect(repo.head_sha).toBe(TASK_REPO_SHA_FIXTURE.head_sha);
    });

    it('task level defaults an unseeded SHA to null rather than omitting the field', () => {
      const result = CODE_REVIEW_NODE_TYPE.act({
        nodeId: 'review-task',
        data: { level: 'task', repos: [REPO_BASE] },
      });
      const payload = result.payload as TaskCodeReviewSpawnPayload;
      expect(payload.repos[0]).toHaveProperty('head_sha', null);
    });

    it('phase level carries exactly the frozen phase_first_sha + phase_head_sha fields, plus phase_plan_doc', () => {
      const result = CODE_REVIEW_NODE_TYPE.act({
        nodeId: 'review-phase',
        data: {
          level: 'phase',
          reviewReportPath: '/project/reviews/P04-phase.md',
          phasePlanDocPath: 'phases/PHASE-04.md',
          repos: [{ ...REPO_BASE, ...PHASE_REPO_SHA_FIXTURE }],
        },
      });
      const payload = result.payload as PhaseCodeReviewSpawnPayload;
      expect(payload.level).toBe('phase');
      expect(payload.phase_plan_doc).toBe('phases/PHASE-04.md');
      const [repo] = payload.repos;
      expect(Object.keys(repo)).toEqual(['name', 'path', 'branch', ...Object.keys(PHASE_REPO_SHA_FIXTURE)]);
      expect(repo.phase_first_sha).toBe(PHASE_REPO_SHA_FIXTURE.phase_first_sha);
      expect(repo.phase_head_sha).toBe(PHASE_REPO_SHA_FIXTURE.phase_head_sha);
    });

    it('final level carries exactly the frozen project_base_sha + project_head_sha fields, plus requirements_doc + phase_plan_paths', () => {
      const result = CODE_REVIEW_NODE_TYPE.act({
        nodeId: 'review-final',
        data: {
          level: 'final',
          reviewReportPath: '/project/reviews/P04-final.md',
          requirementsDocPath: 'REQUIREMENTS.md',
          phasePlanPaths: ['phases/PHASE-01.md', 'phases/PHASE-02.md'],
          repos: [{ ...REPO_BASE, ...FINAL_REPO_SHA_FIXTURE }],
        },
      });
      const payload = result.payload as FinalCodeReviewSpawnPayload;
      expect(payload.level).toBe('final');
      expect(payload.requirements_doc).toBe('REQUIREMENTS.md');
      expect(payload.phase_plan_paths).toEqual(['phases/PHASE-01.md', 'phases/PHASE-02.md']);
      const [repo] = payload.repos;
      expect(Object.keys(repo)).toEqual(['name', 'path', 'branch', ...Object.keys(FINAL_REPO_SHA_FIXTURE)]);
    });

    it('never collapses the three levels onto one shared SHA field name', () => {
      const taskKeys = Object.keys(TASK_REPO_SHA_FIXTURE);
      const phaseKeys = Object.keys(PHASE_REPO_SHA_FIXTURE);
      const finalKeys = Object.keys(FINAL_REPO_SHA_FIXTURE);
      const all = [...taskKeys, ...phaseKeys, ...finalKeys];
      expect(new Set(all).size).toBe(all.length);
    });
  });

  describe('handle — uniform verdict routing', () => {
    it('approved advances with no routing request', () => {
      const result = CODE_REVIEW_NODE_TYPE.handle({
        token: CODE_REVIEW_REVIEWED_TOKEN,
        nodeId: 'review-1',
        envelope: { outcome: 'ok', data: { verdict: 'approved', severity: 'none' } },
      });
      expect(result).toEqual({ dataChange: { verdict: 'approved', severity: 'none' } });
    });

    it('changes_requested routes into add_corrective, born onto this same review node', () => {
      const result = CODE_REVIEW_NODE_TYPE.handle({
        token: CODE_REVIEW_REVIEWED_TOKEN,
        nodeId: 'review-1',
        envelope: {
          outcome: 'ok',
          data: { verdict: 'changes_requested', severity: 'medium', correctiveIndex: 1, reviewReportPath: '/r.md' },
        },
      });
      expect(result).toEqual({
        dataChange: { verdict: 'changes_requested', severity: 'medium' },
        routing: {
          primitive: 'add_corrective',
          params: {
            id: 'review-1-corrective-1',
            type: 'rad-orc:corrective',
            review: 'review-1',
            data: { reviewReportPath: '/r.md', correctiveIndex: 1 },
          },
        },
      });
    });

    it('rejected is a recoverable halt — no routing request', () => {
      const result = CODE_REVIEW_NODE_TYPE.handle({
        token: CODE_REVIEW_REVIEWED_TOKEN,
        nodeId: 'review-1',
        envelope: { outcome: 'ok', data: { verdict: 'rejected', severity: 'high' } },
      });
      expect(result).toEqual({ dataChange: { verdict: 'rejected', severity: 'high' } });
    });

    it('routes identically regardless of level — the scope contract widens, the routing never does', () => {
      for (const level of ['task', 'phase', 'final'] as const) {
        const result = CODE_REVIEW_NODE_TYPE.handle({
          token: CODE_REVIEW_REVIEWED_TOKEN,
          nodeId: `review-${level}`,
          envelope: { outcome: 'ok', data: { verdict: 'approved', severity: 'none', level } },
        });
        expect(result).toEqual({ dataChange: { verdict: 'approved', severity: 'none' } });
      }
    });

    it('handle ignores an unrelated token or an error outcome', () => {
      expect(
        CODE_REVIEW_NODE_TYPE.handle({ token: 'rad-orc:code_review.other', nodeId: 'review-1', envelope: { outcome: 'ok', data: {} } }),
      ).toEqual({});
      expect(
        CODE_REVIEW_NODE_TYPE.handle({ token: CODE_REVIEW_REVIEWED_TOKEN, nodeId: 'review-1', envelope: { outcome: 'error', data: {} } }),
      ).toEqual({});
    });
  });

  it('projectStatus: approved is done, rejected is blocked, changes_requested/unresolved is not_started', () => {
    expect(CODE_REVIEW_NODE_TYPE.projectStatus({})).toBe('not_started');
    expect(CODE_REVIEW_NODE_TYPE.projectStatus({ verdict: 'approved' })).toBe('done');
    expect(CODE_REVIEW_NODE_TYPE.projectStatus({ verdict: 'rejected' })).toBe('blocked');
    expect(CODE_REVIEW_NODE_TYPE.projectStatus({ verdict: 'changes_requested' })).toBe('not_started');
  });
});
