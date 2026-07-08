import { describe, expect, it } from 'vitest';
import { frontier, remaining, deriveContainerStatus, ROOT_NODE_ID, createRootNode } from '../src/index.js';
import type { DagEdge, DagNode } from '../src/index.js';

function node(id: string, overrides: Partial<DagNode> = {}): DagNode {
  return {
    id,
    type: 'rad-orc:task',
    status: 'not_started',
    parent: ROOT_NODE_ID,
    order: 0,
    derivedFrom: null,
    data: {},
    ...overrides,
  };
}

function dependsOn(from: string, to: string): DagEdge {
  return { from, to, kind: 'depends_on' };
}

describe('frontier — root vacuous entry', () => {
  it('returns exactly the first, predecessor-free node under a seeded spine', () => {
    const root = createRootNode();
    const masterPlan = node('master_plan');

    expect(frontier([root, masterPlan], [], ROOT_NODE_ID)).toEqual([masterPlan]);
  });

  it('is empty when the scope node itself is absent or not yet entered', () => {
    const root = createRootNode();
    const masterPlan = node('master_plan');

    expect(frontier([root, masterPlan], [], 'no-such-scope')).toEqual([]);
  });
});

describe('frontier — predecessor gating', () => {
  it('excludes a node behind a single undone predecessor, includes it once done', () => {
    const root = createRootNode();
    const a = node('a', { status: 'not_started' });
    const b = node('b');
    const edges = [dependsOn('a', 'b')];

    expect(frontier([root, a, b], edges, ROOT_NODE_ID)).toEqual([a]);

    const aDone = { ...a, status: 'done' as const };
    expect(frontier([root, aDone, b], edges, ROOT_NODE_ID)).toEqual([b]);
  });

  it('excludes a node while any of several predecessors remain undone', () => {
    const root = createRootNode();
    const a = node('a', { status: 'done' });
    const b = node('b', { status: 'not_started' });
    const c = node('c');
    const edges = [dependsOn('a', 'c'), dependsOn('b', 'c')];

    expect(frontier([root, a, b, c], edges, ROOT_NODE_ID)).toEqual([b]);
  });

  it('includes the node the moment its last predecessor flips to done', () => {
    const root = createRootNode();
    const a = node('a', { status: 'done' });
    const b = node('b', { status: 'done' });
    const c = node('c');
    const edges = [dependsOn('a', 'c'), dependsOn('b', 'c')];

    expect(frontier([root, a, b, c], edges, ROOT_NODE_ID)).toEqual([c]);
  });
});

describe('deriveContainerStatus', () => {
  it('reads in_progress for an entered container with no children yet', () => {
    const phase = node('phase-1');

    expect(deriveContainerStatus(phase, [])).toBe('in_progress');
  });

  it('stays in_progress until every child is done, then rolls to done', () => {
    const phase = node('phase-1');
    const t1 = node('t1', { status: 'done' });
    const t2 = node('t2', { status: 'not_started' });

    expect(deriveContainerStatus(phase, [t1, t2])).toBe('in_progress');
    expect(deriveContainerStatus(phase, [t1, { ...t2, status: 'done' }])).toBe('done');
  });

  it('rolls to done only once a late-added corrective child also reaches done', () => {
    const phase = node('phase-1');
    const t1 = node('t1', { status: 'done' });
    const t2 = node('t2', { status: 'done' });

    expect(deriveContainerStatus(phase, [t1, t2])).toBe('done');

    const corrective = node('t2-corrective', { status: 'not_started', derivedFrom: 't2' });
    expect(deriveContainerStatus(phase, [t1, t2, corrective])).toBe('in_progress');
    expect(deriveContainerStatus(phase, [t1, t2, { ...corrective, status: 'done' }])).toBe('done');
  });

  it('rolls to failed as soon as any child fails', () => {
    const phase = node('phase-1');
    const t1 = node('t1', { status: 'done' });
    const t2 = node('t2', { status: 'failed' });

    expect(deriveContainerStatus(phase, [t1, t2])).toBe('failed');
  });
});

describe('frontier — container entry', () => {
  it('surfaces a container’s children only once the container itself is entered', () => {
    const root = createRootNode();
    const phase = node('phase-1', { parent: ROOT_NODE_ID });
    const blocker = node('blocker', { parent: ROOT_NODE_ID, status: 'not_started' });
    const task = node('task-1', { parent: 'phase-1' });
    const edges = [dependsOn('blocker', 'phase-1')];

    expect(frontier([root, phase, blocker, task], edges, 'phase-1')).toEqual([]);

    const blockerDone = { ...blocker, status: 'done' as const };
    expect(frontier([root, phase, blockerDone, task], edges, 'phase-1')).toEqual([task]);
  });
});

describe('frontier — disabled exclusion', () => {
  it('never surfaces a disabled node even when otherwise fully eligible', () => {
    const root = createRootNode();
    const enabled = node('enabled-task');
    const disabled = node('disabled-task', { disabled: true });

    expect(frontier([root, enabled, disabled], [], ROOT_NODE_ID)).toEqual([enabled]);
  });
});

describe('frontier — scope narrowing', () => {
  it('root scope surfaces its own direct children; a phase scope surfaces only that phase’s tasks', () => {
    const root = createRootNode();
    const phase = node('phase-1', { parent: ROOT_NODE_ID });
    const topLevelTask = node('top-task', { parent: ROOT_NODE_ID });
    const phaseTask = node('phase-task', { parent: 'phase-1' });
    const nodes = [root, phase, topLevelTask, phaseTask];

    expect(frontier(nodes, [], ROOT_NODE_ID)).toEqual([topLevelTask]);
    expect(frontier(nodes, [], 'phase-1')).toEqual([phaseTask]);
  });
});

describe('frontier — additive-corrective satisfaction', () => {
  it('needs no special corrective case: a re-pointed edge onto the corrective falls out of the uniform rule', () => {
    const root = createRootNode();
    const task = node('task-1', { status: 'done' });
    const corrective = node('task-1-corrective', { status: 'not_started', derivedFrom: 'task-1' });
    const review = node('review-1', { status: 'not_started' });
    // The review originally depended on task-1; the corrective cycle re-points that edge onto the
    // corrective instead (and the corrective itself depends on task-1, the node it's correcting).
    const edges = [dependsOn('task-1', 'task-1-corrective'), dependsOn('task-1-corrective', 'review-1')];

    expect(frontier([root, task, corrective, review], edges, ROOT_NODE_ID)).toEqual([corrective]);

    const correctiveDone = { ...corrective, status: 'done' as const };
    expect(frontier([root, task, correctiveDone, review], edges, ROOT_NODE_ID)).toEqual([review]);
  });
});

describe('frontier/remaining — malformed-graph precondition', () => {
  it('throws rather than recursing unbounded on a depends_on cycle between two containers', () => {
    const root = createRootNode();
    const phaseA = node('phase-a');
    const taskA = node('task-a', { parent: 'phase-a' });
    const phaseB = node('phase-b');
    const taskB = node('task-b', { parent: 'phase-b' });
    const edges = [dependsOn('phase-b', 'phase-a'), dependsOn('phase-a', 'phase-b')];

    expect(() => frontier([root, phaseA, taskA, phaseB, taskB], edges, 'phase-a')).toThrow(/cycle/);
  });

  it('throws rather than recursing unbounded on a parent-chain cycle', () => {
    const a = node('a', { parent: 'b' });
    const b = node('b', { parent: 'a' });

    expect(() => frontier([a, b], [], 'a')).toThrow(/cycle/);
    expect(() => remaining([a, b], 'a')).toThrow(/cycle/);
  });
});

describe('remaining', () => {
  it('returns everything not done under scope — a distinct read from frontier', () => {
    const root = createRootNode();
    const done = node('done-task', { status: 'done' });
    const inProgress = node('in-progress-task', { status: 'in_progress' });
    const notStarted = node('not-started-task');

    expect(remaining([root, done, inProgress, notStarted], ROOT_NODE_ID)).toEqual([inProgress, notStarted]);
  });

  it('reads a container as remaining until every descendant is done', () => {
    const root = createRootNode();
    const phase = node('phase-1', { parent: ROOT_NODE_ID });
    const t1 = node('t1', { parent: 'phase-1', status: 'done' });
    const t2 = node('t2', { parent: 'phase-1', status: 'not_started' });

    expect(remaining([root, phase, t1, t2], ROOT_NODE_ID)).toEqual([phase]);

    const t2Done = { ...t2, status: 'done' as const };
    expect(remaining([root, phase, t1, t2Done], ROOT_NODE_ID)).toEqual([]);
  });
});
