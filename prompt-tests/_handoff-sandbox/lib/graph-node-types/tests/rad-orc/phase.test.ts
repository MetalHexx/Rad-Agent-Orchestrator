import { describe, expect, it } from 'vitest';
import { PHASE_NODE_TYPE } from '../../src/rad-orc/phase.js';

describe('rad-orc:phase', () => {
  it('declares the contains trait, a noop executor, and zero capabilities', () => {
    expect(PHASE_NODE_TYPE.name).toBe('rad-orc:phase');
    expect(PHASE_NODE_TYPE.traits).toEqual(['contains']);
    expect(PHASE_NODE_TYPE.capabilities).toEqual([]);
  });

  it('declares its required docPath/exitCriteria data schema', () => {
    expect(PHASE_NODE_TYPE.dataSchema.docPath).toMatchObject({ kind: 'string', level: 'required' });
    expect(PHASE_NODE_TYPE.dataSchema.exitCriteria).toMatchObject({ kind: 'array', level: 'required' });
  });

  it('act carries no operator action, executor noop', () => {
    const result = PHASE_NODE_TYPE.act({ nodeId: 'phase-1', data: {} });
    expect(result.executor).toBe('noop');
  });

  it('handle never reacts — a container has nothing of its own to mutate', () => {
    const result = PHASE_NODE_TYPE.handle({ token: 'rad-orc:phase.anything', nodeId: 'phase-1', envelope: { outcome: 'ok', data: {} } });
    expect(result).toEqual({});
  });

  it('projectStatus is a fixed fallback — the engine derives the real status from children', () => {
    expect(PHASE_NODE_TYPE.projectStatus({})).toBe('not_started');
    expect(PHASE_NODE_TYPE.projectStatus({ docPath: 'phases/PHASE-01.md' })).toBe('not_started');
  });
});
