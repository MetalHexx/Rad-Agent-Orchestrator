import { describe, expect, it } from 'vitest';
import type { DagNode } from '@rad-orchestration/graph-engine';
import {
  MASTER_PLAN_AUTHORED_TOKEN,
  MASTER_PLAN_DATA_SCHEMA,
  MASTER_PLAN_NODE_TYPE,
} from '../../src/rad-orc/master-plan.js';

describe('rad-orc:master_plan', () => {
  it('declares an orchestrator-inline executor and doc-read/doc-write capabilities', () => {
    expect(MASTER_PLAN_NODE_TYPE.name).toBe('rad-orc:master_plan');
    expect(MASTER_PLAN_NODE_TYPE.capabilities).toEqual(['doc-read', 'doc-write']);
  });

  it('declares resolve hints on requirementsDocPath and docPath', () => {
    expect(MASTER_PLAN_DATA_SCHEMA.requirementsDocPath.resolve).toBe('project-doc-path');
    expect(MASTER_PLAN_DATA_SCHEMA.docPath.resolve).toBe('project-doc-path');
  });

  it('declares the master_plan.authored completion payload schema', () => {
    expect(MASTER_PLAN_NODE_TYPE.completionPayloadSchema).toEqual([{ name: 'doc_path', flag: true }]);
  });

  it('act returns inline executor and no instructions key', () => {
    const result = MASTER_PLAN_NODE_TYPE.act({ nodeId: 'master_plan', data: {}, nodes: [], edges: [] });
    expect(result.executor).toBe('orchestrator-inline');
    expect(result).not.toHaveProperty('instructions');
  });

  it('act omits last_parse_error on the payload when no explosion sibling carries one', () => {
    const result = MASTER_PLAN_NODE_TYPE.act({ nodeId: 'master_plan', data: {}, nodes: [], edges: [] });
    expect((result as unknown as Record<string, unknown>).payload).toBeUndefined();
  });

  it('act includes last_parse_error on the payload when explosion sibling carries lastParseError', () => {
    const lastParseError = { line: 5, expected: 'string', found: 'none', message: 'test error' };
    const explosionNode: DagNode = {
      id: 'explosion-1',
      type: 'rad-orc:explosion',
      status: 'not_started',
      parent: null,
      order: 0,
      derivedFrom: null,
      data: { lastParseError },
    };
    const result = MASTER_PLAN_NODE_TYPE.act({ nodeId: 'master_plan', data: {}, nodes: [explosionNode], edges: [] });
    expect(result.executor).toBe('orchestrator-inline');
    const payload = (result as unknown as Record<string, unknown>).payload as unknown as Record<string, unknown>;
    expect(payload.last_parse_error).toEqual(lastParseError);
  });

  it('act tolerates absence of explosion sibling node (first authoring)', () => {
    const result = MASTER_PLAN_NODE_TYPE.act({ nodeId: 'master_plan', data: {}, nodes: [], edges: [] });
    expect(result.executor).toBe('orchestrator-inline');
    expect((result as unknown as Record<string, unknown>).payload).toBeUndefined();
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
