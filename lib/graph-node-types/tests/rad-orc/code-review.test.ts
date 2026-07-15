import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import type { DagNode, ResolveContext } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import {
  CODE_REVIEW_DATA_SCHEMA,
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
import { createFakedCapabilityPorts } from '../harness/test-driver.js';

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
      expect(payload).not.toHaveProperty('kind');
      expect(payload.level).toBe('task');
      expect(payload.handoff_doc).toBe('/project/tasks/EXAMPLE-TASK-P04-T04.md');
      expect(payload.review_report_path).toBe('/project/reviews/P04-T04.md');
      expect(payload).not.toHaveProperty('handoffDoc');
      expect(Object.keys(payload).sort()).toEqual(['agent', 'handoff_doc', 'level', 'repos', 'review_report_path'].sort());
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
      expect(payload).not.toHaveProperty('handoffDoc');
      expect(payload).not.toHaveProperty('handoff_doc');
      expect(Object.keys(payload).sort()).toEqual(['agent', 'level', 'phase_plan_doc', 'repos', 'review_report_path'].sort());
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
      expect(payload).not.toHaveProperty('handoffDoc');
      expect(payload).not.toHaveProperty('handoff_doc');
      expect(Object.keys(payload).sort()).toEqual(
        ['agent', 'level', 'requirements_doc', 'phase_plan_paths', 'repos', 'review_report_path'].sort(),
      );
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

  describe('act — reviewer tiering', () => {
    it.each([
      ['simple', 'reviewer-junior'],
      ['standard', 'reviewer'],
      ['complex', 'reviewer'],
    ] as const)('task level with %s complexity resolves to agent %s', (complexity, agent) => {
      const result = CODE_REVIEW_NODE_TYPE.act({
        nodeId: 'review-task',
        data: { level: 'task', reviewReportPath: '/r.md', complexity, repos: [REPO_BASE] },
      });
      expect((result.payload as TaskCodeReviewSpawnPayload).agent).toBe(agent);
    });

    it('task level with no complexity defaults to agent reviewer', () => {
      const result = CODE_REVIEW_NODE_TYPE.act({
        nodeId: 'review-task',
        data: { level: 'task', reviewReportPath: '/r.md', repos: [REPO_BASE] },
      });
      expect((result.payload as TaskCodeReviewSpawnPayload).agent).toBe('reviewer');
    });

    it('phase level with complexity: simple still yields reviewer — the easy-to-get-wrong case', () => {
      const result = CODE_REVIEW_NODE_TYPE.act({
        nodeId: 'review-phase',
        data: { level: 'phase', reviewReportPath: '/r.md', complexity: 'simple', repos: [REPO_BASE] },
      });
      expect((result.payload as PhaseCodeReviewSpawnPayload).agent).toBe('reviewer');
    });

    it('final level with complexity: simple still yields reviewer', () => {
      const result = CODE_REVIEW_NODE_TYPE.act({
        nodeId: 'review-final',
        data: { level: 'final', reviewReportPath: '/r.md', complexity: 'simple', repos: [REPO_BASE] },
      });
      expect((result.payload as FinalCodeReviewSpawnPayload).agent).toBe('reviewer');
    });
  });

  describe('dataSchema — resolvables and the completion payload', () => {
    it('declares resolve hints on all six path-bearing fields', () => {
      expect(CODE_REVIEW_DATA_SCHEMA.repos.resolve).toBe('worktree-repo-set');
      expect(CODE_REVIEW_DATA_SCHEMA.handoffDocPath.resolve).toBe('project-doc-path');
      expect(CODE_REVIEW_DATA_SCHEMA.phasePlanDocPath.resolve).toBe('project-doc-path');
      expect(CODE_REVIEW_DATA_SCHEMA.requirementsDocPath.resolve).toBe('project-doc-path');
      expect(CODE_REVIEW_DATA_SCHEMA.reviewReportPath.resolve).toBe('project-doc-path');
      expect(CODE_REVIEW_DATA_SCHEMA.phasePlanPaths.resolve).toBe('project-doc-path');
    });

    it('declares complexity as an optional string field', () => {
      expect(CODE_REVIEW_DATA_SCHEMA.complexity).toMatchObject({ kind: 'string', level: 'optional' });
    });

    it('declares the code_review.reviewed completion payload schema', () => {
      expect(CODE_REVIEW_NODE_TYPE.completionPayloadSchema).toEqual([
        { name: 'verdict', flag: true },
        { name: 'severity', flag: true },
      ]);
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

  it('declares its completion token, the sole external-actor stop signal for this node type', () => {
    expect(CODE_REVIEW_NODE_TYPE.completionToken).toBe(CODE_REVIEW_REVIEWED_TOKEN);
  });

  describe('resolve — re-derives the verdict from the running report, never trusting a caller', () => {
    const CUSTOM_REPORT_PATH = 'reviews/custom-report.md';

    function siblingCorrective(id: string): DagNode {
      return { id, type: 'rad-orc:corrective', status: 'done', parent: ROOT_NODE_ID, order: 0, derivedFrom: null, data: {} };
    }

    function buildContext(
      ports: ReturnType<typeof createFakedCapabilityPorts>,
      overrides: { readonly data?: Readonly<Record<string, unknown>>; readonly nodes?: readonly DagNode[] } = {},
    ): ResolveContext {
      return {
        nodeId: 'review-1',
        data: { level: 'task', ...overrides.data },
        nodes: overrides.nodes ?? [],
        edges: [],
        ports,
      };
    }

    it('approved: yields the matching outcome, carrying no correctiveIndex/reviewReportPath', async () => {
      const ports = createFakedCapabilityPorts();
      ports.docRead.seed(CUSTOM_REPORT_PATH, '---\nverdict: approved\nseverity: none\n---\nBody.\n');

      const result = await CODE_REVIEW_NODE_TYPE.resolve!(buildContext(ports, { data: { reviewReportPath: CUSTOM_REPORT_PATH } }));

      expect(result.token).toBe(CODE_REVIEW_REVIEWED_TOKEN);
      expect(result.envelope).toEqual({ outcome: 'ok', data: { verdict: 'approved', severity: 'none' } });
    });

    it('changes_requested: computes correctiveIndex from ctx.nodes\' own -corrective-* siblings', async () => {
      const ports = createFakedCapabilityPorts();
      ports.docRead.seed(CUSTOM_REPORT_PATH, '---\nverdict: changes_requested\nseverity: high\n---\nBody.\n');

      const result = await CODE_REVIEW_NODE_TYPE.resolve!(
        buildContext(ports, {
          data: { reviewReportPath: CUSTOM_REPORT_PATH },
          nodes: [siblingCorrective('review-1-corrective-1'), siblingCorrective('review-1-corrective-2'), siblingCorrective('review-2-corrective-1')],
        }),
      );

      expect(result.envelope).toEqual({
        outcome: 'ok',
        data: { verdict: 'changes_requested', severity: 'high', correctiveIndex: 3, reviewReportPath: CUSTOM_REPORT_PATH },
      });
    });

    it('defaults severity to none when the frontmatter omits it', async () => {
      const ports = createFakedCapabilityPorts();
      ports.docRead.seed(CUSTOM_REPORT_PATH, '---\nverdict: approved\n---\nBody.\n');

      const result = await CODE_REVIEW_NODE_TYPE.resolve!(buildContext(ports, { data: { reviewReportPath: CUSTOM_REPORT_PATH } }));

      expect(result.envelope).toEqual({ outcome: 'ok', data: { verdict: 'approved', severity: 'none' } });
    });

    it('falls back to reviews/{nodeId}.md when no reviewReportPath is declared', async () => {
      const ports = createFakedCapabilityPorts();
      ports.docRead.seed('reviews/review-1.md', '---\nverdict: rejected\nseverity: low\n---\nBody.\n');

      const result = await CODE_REVIEW_NODE_TYPE.resolve!(buildContext(ports));

      expect(result.envelope).toEqual({ outcome: 'ok', data: { verdict: 'rejected', severity: 'low' } });
    });

    it('throws a clear error when the report cannot be read', async () => {
      const ports = createFakedCapabilityPorts();
      await expect(CODE_REVIEW_NODE_TYPE.resolve!(buildContext(ports, { data: { reviewReportPath: CUSTOM_REPORT_PATH } }))).rejects.toThrow(
        /could not read its review report/,
      );
    });

    it('throws a clear error when the frontmatter carries no valid verdict', async () => {
      const ports = createFakedCapabilityPorts();
      ports.docRead.seed(CUSTOM_REPORT_PATH, '---\nverdict: not-a-real-verdict\n---\nBody.\n');

      await expect(CODE_REVIEW_NODE_TYPE.resolve!(buildContext(ports, { data: { reviewReportPath: CUSTOM_REPORT_PATH } }))).rejects.toThrow(
        /no valid 'verdict'/,
      );
    });
  });
});
