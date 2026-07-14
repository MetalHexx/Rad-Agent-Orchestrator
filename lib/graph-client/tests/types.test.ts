import { describe, expect, it } from 'vitest';
import { EXECUTORS, NODE_STATUSES } from '../src/index.js';
import type { DagSnapshot, NextActionEnvelope, NodeView } from '../src/index.js';

describe('NodeStatus vocabulary', () => {
  it('has exactly the mirrored status members', () => {
    expect(NODE_STATUSES).toEqual(['not_started', 'in_progress', 'done', 'blocked', 'failed']);
  });

  it('excludes a non-member value', () => {
    expect((NODE_STATUSES as readonly string[]).includes('cancelled')).toBe(false);
  });
});

describe('Executor vocabulary', () => {
  it('has exactly the mirrored executor kinds', () => {
    expect(EXECUTORS).toEqual(['spawn-sub-agent', 'orchestrator-inline', 'request-human', 'noop']);
  });

  it('excludes a non-member value', () => {
    expect((EXECUTORS as readonly string[]).includes('bogus')).toBe(false);
  });
});

describe('wire mirror shapes', () => {
  it('a well-formed NodeView round-trips through JSON with every field intact', () => {
    const node: NodeView = {
      id: 'n1',
      type: 'task:coding',
      status: 'in_progress',
      parent: 'root',
      order: 0,
      derivedFrom: null,
      data: { title: 'do the thing' },
      presentation: { label: 'Do the thing' },
    };

    const roundTripped = JSON.parse(JSON.stringify(node)) as NodeView;
    expect(roundTripped).toEqual(node);
  });

  it('a well-formed DagSnapshot carries nodes, edges, frontier, and status together', () => {
    const node: NodeView = {
      id: 'root',
      type: 'system:root',
      status: 'in_progress',
      parent: null,
      order: 0,
      derivedFrom: null,
      data: {},
      presentation: { label: 'Root' },
    };
    const snapshot: DagSnapshot = {
      nodes: [node],
      edges: [],
      frontier: [node],
      status: 'in_progress',
    };

    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.frontier[0]?.id).toBe('root');
    expect(snapshot.status).toBe('in_progress');
  });

  it('a well-formed NextActionEnvelope carries a delta and frontier snapshot together', () => {
    const node: NodeView = {
      id: 'n1',
      type: 'task:coding',
      status: 'done',
      parent: 'root',
      order: 0,
      derivedFrom: null,
      data: {},
      presentation: { label: 'Do the thing' },
    };
    const envelope: NextActionEnvelope = {
      action: null,
      node: null,
      executor: null,
      instructions: null,
      context: null,
      completion_event: null,
      delta: { primitive: 'apply_event', params: {}, nodeChanges: [], edgeChanges: [] },
      frontier: [node],
    };

    expect(envelope.delta.primitive).toBe('apply_event');
    expect(envelope.frontier).toHaveLength(1);
  });
});
