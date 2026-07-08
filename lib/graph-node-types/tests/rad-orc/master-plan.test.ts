import { describe, expect, it } from 'vitest';
import {
  MASTER_PLAN_AUTHORED_TOKEN,
  MASTER_PLAN_NODE_TYPE,
} from '../../src/rad-orc/master-plan.js';

describe('rad-orc:master_plan', () => {
  it('declares an orchestrator-inline executor and doc-read/doc-write capabilities', () => {
    expect(MASTER_PLAN_NODE_TYPE.name).toBe('rad-orc:master_plan');
    expect(MASTER_PLAN_NODE_TYPE.capabilities).toEqual(['doc-read', 'doc-write']);
  });

  it('act returns inline instructions naming the doc-read requirements target and executor orchestrator-inline', () => {
    const result = MASTER_PLAN_NODE_TYPE.act({ nodeId: 'master_plan', data: {} });
    expect(result.executor).toBe('orchestrator-inline');
    expect(result.instructions).toMatch(/doc-read/);
    expect(result.instructions).toMatch(/doc-write/);
  });

  it('act honors a seeded requirementsDocPath override', () => {
    const result = MASTER_PLAN_NODE_TYPE.act({ nodeId: 'master_plan', data: { requirementsDocPath: 'custom/REQS.md' } });
    expect(result.instructions).toContain('custom/REQS.md');
  });

  it('handle sets docPath once the plan doc is authored', () => {
    const result = MASTER_PLAN_NODE_TYPE.handle({
      token: MASTER_PLAN_AUTHORED_TOKEN,
      nodeId: 'master_plan',
      envelope: { outcome: 'ok', data: { docPath: 'docs/MASTER-PLAN.md' } },
    });
    expect(result).toEqual({ dataChange: { docPath: 'docs/MASTER-PLAN.md' } });
  });

  it('handle ignores an unrelated token or an error outcome', () => {
    expect(
      MASTER_PLAN_NODE_TYPE.handle({ token: 'rad-orc:master_plan.other', nodeId: 'master_plan', envelope: { outcome: 'ok', data: {} } }),
    ).toEqual({});
    expect(
      MASTER_PLAN_NODE_TYPE.handle({ token: MASTER_PLAN_AUTHORED_TOKEN, nodeId: 'master_plan', envelope: { outcome: 'error', data: {} } }),
    ).toEqual({});
  });

  it('projectStatus reads done once docPath is set, not_started otherwise', () => {
    expect(MASTER_PLAN_NODE_TYPE.projectStatus({})).toBe('not_started');
    expect(MASTER_PLAN_NODE_TYPE.projectStatus({ docPath: '' })).toBe('not_started');
    expect(MASTER_PLAN_NODE_TYPE.projectStatus({ docPath: 'docs/MASTER-PLAN.md' })).toBe('done');
  });
});
