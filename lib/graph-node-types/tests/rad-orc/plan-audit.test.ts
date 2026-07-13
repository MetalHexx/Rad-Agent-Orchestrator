import { describe, expect, it } from 'vitest';
import {
  add_corrective_gate,
  createNodeTypeRegistry,
  InMemoryStateStore,
  ROOT_NODE_ID,
} from '@rad-orchestration/graph-engine';
import type { AuditSpawnRequest, DagNode, NodeTypeName, PrimitiveContext, ProjectScope, RoutingRequest } from '@rad-orchestration/graph-engine';
import {
  PLAN_AUDIT_NODE_TYPE,
  PLAN_AUDIT_AUDITED_TOKEN,
  PLAN_AUDIT_VERDICTS,
} from '../../src/rad-orc/plan-audit.js';
import { PLAN_CORRECTIVE_NODE_TYPE } from '../../src/rad-orc/plan-corrective.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

function node(id: string, overrides: Partial<DagNode> = {}): DagNode {
  return { id, type: 'rad-orc:task', status: 'not_started', parent: ROOT_NODE_ID, order: 0, derivedFrom: null, data: {}, ...overrides };
}

function seed(ctx: PrimitiveContext, nodes: DagNode[]): void {
  const result = ctx.store.apply(ctx.scope, {
    primitive: 'add_node',
    params: {},
    nodeChanges: nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edgeChanges: [],
  });
  if (!result.ok) throw new Error(`seed failed: ${result.error.message}`);
}

describe('rad-orc:plan_audit', () => {
  it('declares the routes trait and spawn-agent/doc-read capabilities', () => {
    expect(PLAN_AUDIT_NODE_TYPE.name).toBe('rad-orc:plan_audit');
    expect(PLAN_AUDIT_NODE_TYPE.traits).toEqual(['routes']);
    expect(PLAN_AUDIT_NODE_TYPE.capabilities).toEqual(['spawn-agent', 'doc-read']);
  });

  it('carries the rubric in its own instructions, naming all four lenses', () => {
    expect(PLAN_AUDIT_NODE_TYPE.instructions.length).toBeGreaterThan(0);
    for (const lens of ['Accurate', 'Consistent', 'Coherent', 'Complete']) {
      expect(PLAN_AUDIT_NODE_TYPE.instructions).toContain(lens);
    }
  });

  describe('act — the auditor spawn', () => {
    it('spawns an auditor carrying both doc paths and the report path', () => {
      const result = PLAN_AUDIT_NODE_TYPE.act({
        nodeId: 'plan-audit-1',
        data: {
          requirementsDocPath: '/project/REQUIREMENTS.md',
          masterPlanDocPath: '/project/plans/MASTER-PLAN.md',
          reviewReportPath: '/project/reviews/plan-audit.md',
        },
      });
      expect(result.executor).toBe('spawn-sub-agent');
      const payload = result.payload as AuditSpawnRequest;
      expect(payload).toEqual({
        kind: 'auditor',
        requirementsDoc: '/project/REQUIREMENTS.md',
        masterPlanDoc: '/project/plans/MASTER-PLAN.md',
        reviewReportPath: '/project/reviews/plan-audit.md',
      });
    });

    it('defaults unseeded doc paths to empty strings rather than throwing', () => {
      const result = PLAN_AUDIT_NODE_TYPE.act({ nodeId: 'plan-audit-1', data: {} });
      const payload = result.payload as AuditSpawnRequest;
      expect(payload).toEqual({ kind: 'auditor', requirementsDoc: '', masterPlanDoc: '', reviewReportPath: '' });
    });
  });

  describe('handle — verdict routing', () => {
    it('approved advances with no routing request', () => {
      const result = PLAN_AUDIT_NODE_TYPE.handle({
        token: PLAN_AUDIT_AUDITED_TOKEN,
        nodeId: 'plan-audit-1',
        envelope: { outcome: 'ok', data: { verdict: 'approved' } },
      });
      expect(result).toEqual({ dataChange: { verdict: 'approved' } });
    });

    it('issues_found gates the plan approval via add_corrective_gate, births rad-orc:plan_corrective (not add_corrective / rad-orc:corrective)', () => {
      const result = PLAN_AUDIT_NODE_TYPE.handle({
        token: PLAN_AUDIT_AUDITED_TOKEN,
        nodeId: 'plan-audit-1',
        envelope: {
          outcome: 'ok',
          data: {
            verdict: 'issues_found',
            correctiveIndex: 1,
            reviewReportPath: '/project/reviews/plan-audit.md',
            masterPlanDoc: '/project/plans/MASTER-PLAN.md',
            planApprovalNodeId: 'plan_approval',
          },
        },
      });
      expect(result).toEqual({
        dataChange: { verdict: 'issues_found' },
        routing: {
          primitive: 'add_corrective_gate',
          params: {
            id: 'plan-audit-1-corrective-1',
            type: 'rad-orc:plan_corrective',
            source: 'plan-audit-1',
            gate: 'plan_approval',
            options: { data: { masterPlanDoc: '/project/plans/MASTER-PLAN.md', reviewReportPath: '/project/reviews/plan-audit.md' } },
          },
        },
      });
    });

    it('issues_found requires planApprovalNodeId on the envelope', () => {
      expect(() =>
        PLAN_AUDIT_NODE_TYPE.handle({
          token: PLAN_AUDIT_AUDITED_TOKEN,
          nodeId: 'plan-audit-1',
          envelope: { outcome: 'ok', data: { verdict: 'issues_found' } },
        }),
      ).toThrow(/planApprovalNodeId/);
    });

    it('handle ignores an unrelated token or an error outcome', () => {
      expect(
        PLAN_AUDIT_NODE_TYPE.handle({ token: 'rad-orc:plan_audit.other', nodeId: 'plan-audit-1', envelope: { outcome: 'ok', data: {} } }),
      ).toEqual({});
      expect(
        PLAN_AUDIT_NODE_TYPE.handle({ token: PLAN_AUDIT_AUDITED_TOKEN, nodeId: 'plan-audit-1', envelope: { outcome: 'error', data: {} } }),
      ).toEqual({});
    });
  });

  it('seam: the routing an issues_found verdict emits actually births a node the registry resolves as rad-orc:plan_corrective', () => {
    const registry = createNodeTypeRegistry([PLAN_AUDIT_NODE_TYPE, PLAN_CORRECTIVE_NODE_TYPE]);
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('plan_audit', { type: 'rad-orc:plan_audit' }), node('plan_approval')]);

    const result = PLAN_AUDIT_NODE_TYPE.handle({
      token: PLAN_AUDIT_AUDITED_TOKEN,
      nodeId: 'plan_audit',
      envelope: {
        outcome: 'ok',
        data: {
          verdict: 'issues_found',
          correctiveIndex: 1,
          reviewReportPath: '/project/reviews/plan-audit.md',
          masterPlanDoc: '/project/plans/MASTER-PLAN.md',
          planApprovalNodeId: 'plan_approval',
        },
      },
    });
    const routing = result.routing as RoutingRequest;
    const params = routing.params as { id: string; type: NodeTypeName; source: string; gate: string; options?: { data?: Record<string, unknown> } };

    const applied = add_corrective_gate(ctx, params.id, params.type, params.source, params.gate, params.options);
    expect(applied.ok).toBe(true);

    const created = ctx.store.getNode(ctx.scope, params.id);
    expect(created).not.toBeNull();
    expect(registry.resolve(created!.type)).toBe(PLAN_CORRECTIVE_NODE_TYPE);
    expect(created!.data).toEqual({ masterPlanDoc: '/project/plans/MASTER-PLAN.md', reviewReportPath: '/project/reviews/plan-audit.md' });
  });

  it('projectStatus: both verdicts hold the audit done — neither re-runs it nor re-enters the frontier', () => {
    expect(PLAN_AUDIT_NODE_TYPE.projectStatus({})).toBe('not_started');
    for (const verdict of PLAN_AUDIT_VERDICTS) {
      expect(PLAN_AUDIT_NODE_TYPE.projectStatus({ verdict })).toBe('done');
    }
  });
});
