import { describe, expect, it } from 'vitest';
import {
  PLAN_AUDIT_NODE_TYPE,
  PLAN_AUDIT_AUDITED_TOKEN,
  PLAN_AUDIT_VERDICTS,
} from '../../src/rad-orc/plan-audit.js';
import type { AuditSpawnRequest } from '@rad-orchestration/graph-engine';

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

    it('issues_found gates the plan approval via add_corrective_gate, not add_corrective', () => {
      const result = PLAN_AUDIT_NODE_TYPE.handle({
        token: PLAN_AUDIT_AUDITED_TOKEN,
        nodeId: 'plan-audit-1',
        envelope: {
          outcome: 'ok',
          data: {
            verdict: 'issues_found',
            correctiveIndex: 1,
            reviewReportPath: '/project/reviews/plan-audit.md',
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
            type: 'rad-orc:corrective',
            source: 'plan-audit-1',
            gate: 'plan_approval',
            options: { data: { reviewReportPath: '/project/reviews/plan-audit.md', correctiveIndex: 1 } },
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

  it('projectStatus: both verdicts hold the audit done — neither re-runs it nor re-enters the frontier', () => {
    expect(PLAN_AUDIT_NODE_TYPE.projectStatus({})).toBe('not_started');
    for (const verdict of PLAN_AUDIT_VERDICTS) {
      expect(PLAN_AUDIT_NODE_TYPE.projectStatus({ verdict })).toBe('done');
    }
  });
});
