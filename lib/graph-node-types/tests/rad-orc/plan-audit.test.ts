import { createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_NODE_TYPES } from '../../src/index.js';
import {
  PLAN_AUDIT_AUDITED_TOKEN,
  PLAN_AUDIT_NODE_TYPE,
} from '../../src/rad-orc/plan-audit.js';

describe('rad-orc:plan_audit', () => {
  it('declares an orchestrator-inline executor and doc-read/doc-write capabilities', () => {
    expect(PLAN_AUDIT_NODE_TYPE.name).toBe('rad-orc:plan_audit');
    expect(PLAN_AUDIT_NODE_TYPE.capabilities).toEqual(['doc-read', 'doc-write']);
  });

  it('act returns inline executor with no instructions key or payload', () => {
    const result = PLAN_AUDIT_NODE_TYPE.act({ nodeId: 'plan_audit', data: {}, nodes: [], edges: [] });
    expect(result.executor).toBe('orchestrator-inline');
    expect(result.payload).toBeUndefined();
    expect(result).not.toHaveProperty('instructions');
  });

  it('bakes all four audit lenses into the instructions', () => {
    for (const lens of ['Accurate', 'Consistent', 'Coherent', 'Complete']) {
      expect(PLAN_AUDIT_NODE_TYPE.instructions).toContain(lens);
    }
  });

  it('handle sets audited on a matching token with an ok outcome', () => {
    const result = PLAN_AUDIT_NODE_TYPE.handle({
      token: PLAN_AUDIT_AUDITED_TOKEN,
      nodeId: 'plan_audit',
      envelope: { outcome: 'ok', data: {} },
    });
    expect(result).toEqual({ dataChange: { audited: true } });
  });

  it('handle ignores an unrelated token or an error outcome', () => {
    expect(
      PLAN_AUDIT_NODE_TYPE.handle({ token: 'rad-orc:plan_audit.other', nodeId: 'plan_audit', envelope: { outcome: 'ok', data: {} } }),
    ).toEqual({});
    expect(
      PLAN_AUDIT_NODE_TYPE.handle({ token: PLAN_AUDIT_AUDITED_TOKEN, nodeId: 'plan_audit', envelope: { outcome: 'error', data: {} } }),
    ).toEqual({});
  });

  it('projectStatus reads done once audited is true, not_started otherwise', () => {
    expect(PLAN_AUDIT_NODE_TYPE.projectStatus({})).toBe('not_started');
    expect(PLAN_AUDIT_NODE_TYPE.projectStatus({ audited: false })).toBe('not_started');
    expect(PLAN_AUDIT_NODE_TYPE.projectStatus({ audited: true })).toBe('done');
  });

  it('is a member of BUILT_IN_NODE_TYPES and resolves via a constructed registry', () => {
    expect(BUILT_IN_NODE_TYPES).toContain(PLAN_AUDIT_NODE_TYPE);
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    expect(registry.resolve('rad-orc:plan_audit')?.name).toBe('rad-orc:plan_audit');
  });
});
