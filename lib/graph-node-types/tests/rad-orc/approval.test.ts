import { describe, expect, it } from 'vitest';
import {
  APPROVAL_DECIDED_TOKEN,
  APPROVAL_NODE_TYPE,
} from '../../src/rad-orc/approval.js';

describe('rad-orc:approval', () => {
  it('declares a request-human executor and the routes trait', () => {
    expect(APPROVAL_NODE_TYPE.name).toBe('rad-orc:approval');
    expect(APPROVAL_NODE_TYPE.traits).toEqual(['routes']);
    expect(APPROVAL_NODE_TYPE.capabilities).toEqual(['request-human']);
  });

  it('act prompts for the plan-level decision by default and the final-level decision when seeded', () => {
    expect(APPROVAL_NODE_TYPE.act({ nodeId: 'approval-plan', data: {} }).instructions).toMatch(/plan-level/);
    expect(APPROVAL_NODE_TYPE.act({ nodeId: 'approval-final', data: { level: 'final' } }).instructions).toMatch(/final-level/);
  });

  it('granted advances with no routing request, at either level', () => {
    for (const level of ['plan', 'final'] as const) {
      const result = APPROVAL_NODE_TYPE.handle({
        token: APPROVAL_DECIDED_TOKEN,
        nodeId: 'approval',
        envelope: { outcome: 'ok', data: { decision: 'granted', level } },
      });
      expect(result).toEqual({ dataChange: { decision: 'granted' } });
    }
  });

  it('plan-level denied cascade-resets master_plan', () => {
    const result = APPROVAL_NODE_TYPE.handle({
      token: APPROVAL_DECIDED_TOKEN,
      nodeId: 'approval-plan',
      envelope: { outcome: 'ok', data: { decision: 'denied', level: 'plan', masterPlanNodeId: 'master_plan' } },
    });
    expect(result).toEqual({
      dataChange: { decision: 'denied' },
      routing: { primitive: 'reset', params: { node: 'master_plan', cascade: true } },
    });
  });

  it('plan-level denied without a masterPlanNodeId is a programmer error, not a silent no-op', () => {
    expect(() =>
      APPROVAL_NODE_TYPE.handle({
        token: APPROVAL_DECIDED_TOKEN,
        nodeId: 'approval-plan',
        envelope: { outcome: 'ok', data: { decision: 'denied', level: 'plan' } },
      }),
    ).toThrow(/masterPlanNodeId/);
  });

  it('final-level denied is a recoverable halt — no routing request', () => {
    const result = APPROVAL_NODE_TYPE.handle({
      token: APPROVAL_DECIDED_TOKEN,
      nodeId: 'approval-final',
      envelope: { outcome: 'ok', data: { decision: 'denied', level: 'final' } },
    });
    expect(result).toEqual({ dataChange: { decision: 'denied' } });
  });

  it('handle ignores an unrelated token or an error outcome', () => {
    expect(
      APPROVAL_NODE_TYPE.handle({ token: 'rad-orc:approval.other', nodeId: 'approval', envelope: { outcome: 'ok', data: {} } }),
    ).toEqual({});
    expect(
      APPROVAL_NODE_TYPE.handle({ token: APPROVAL_DECIDED_TOKEN, nodeId: 'approval', envelope: { outcome: 'error', data: {} } }),
    ).toEqual({});
  });

  it('projectStatus: granted is done, denied is blocked (recoverable), unresolved is not_started', () => {
    expect(APPROVAL_NODE_TYPE.projectStatus({})).toBe('not_started');
    expect(APPROVAL_NODE_TYPE.projectStatus({ decision: 'granted' })).toBe('done');
    expect(APPROVAL_NODE_TYPE.projectStatus({ decision: 'denied' })).toBe('blocked');
  });
});
