import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { portfolioProvision, splitDependsOn } from '../../../src/commands/portfolio/provision.js';
import type { PortfolioProvisionOptions } from '../../../src/commands/portfolio/provision.js';
import { SystemError, UserError } from '../../../src/framework/errors.js';
import type { GraphPort } from '../../../src/commands/portfolio/graph-port.js';
import type { FsReads } from '../../../src/commands/portfolio/identity.js';

const PROJECTS_DIR = path.join('root', 'projects');
const ROOT_DIR = 'TESTPORT-ROOT';
const ROOT_DOC = path.join(PROJECTS_DIR, ROOT_DIR, `${ROOT_DIR}.md`);
const GROUP_ID = 'group:testport';
const ITERATION = 'ITER-02';
const DIR_PATH = path.join(PROJECTS_DIR, ITERATION);

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: 'validation' | 'stale_revision'; message: string } };
type Edge = { type: string; from: string; to: string };
type Node = { id: string; kind: 'project' | 'group'; name?: string };

interface PortOverrides {
  groups?: { id: string; name: string }[];
  members?: { id: string }[];
  nodes?: Node[];
  edges?: Edge[];
  addMember?: (groupId: string, projectId: string) => Result<{ edge: Edge; rev: number }>;
  removeMember?: (groupId: string, projectId: string) => Result<{ rev: number }>;
  recordDependency?: (from: string, to: string) => Result<{ edge: Edge; rev: number }>;
  /** Records `getGraph` into `calls` too, for the tests that pin read-before-write order. */
  traceReads?: boolean;
}

/** A `GraphPort` stub that records every mutating call (in order) to `calls`. */
function makePort(overrides: PortOverrides, calls: string[]): GraphPort {
  const nodes: Node[] = overrides.nodes ?? [{ id: ROOT_DIR, kind: 'project' }];
  const addMember = vi.fn((groupId: string, projectId: string) => {
    calls.push('addMember');
    return overrides.addMember
      ? overrides.addMember(groupId, projectId)
      : { ok: true as const, data: { edge: { type: 'contains', from: groupId, to: projectId }, rev: 2 } };
  });
  const removeMember = vi.fn((groupId: string, projectId: string) => {
    calls.push('removeMember');
    return overrides.removeMember ? overrides.removeMember(groupId, projectId) : { ok: true as const, data: { rev: 3 } };
  });
  const recordDependency = vi.fn((from: string, to: string) => {
    calls.push('recordDependency');
    return overrides.recordDependency
      ? overrides.recordDependency(from, to)
      : { ok: true as const, data: { edge: { type: 'depends-on', from, to }, rev: 5 } };
  });
  return {
    listGroups: () => overrides.groups ?? [{ id: GROUP_ID, name: 'TESTPORT' }],
    listMembers: () => overrides.members ?? [{ id: ROOT_DIR }],
    getGraph: () => {
      if (overrides.traceReads) calls.push('getGraph');
      return { schema: 'work-graph/v1', nodes, edges: overrides.edges ?? [], danglingEdges: [] };
    },
    createGroup: vi.fn(),
    deleteGroup: vi.fn(),
    addMember,
    removeMember,
    recordDependency,
  } as unknown as GraphPort;
}

/** Only the paths listed exist; everything else is absent. */
function makeFs(present: string[]): FsReads {
  const set = new Set(present);
  return {
    exists: (p: string) => set.has(p),
    readFile: () => '',
    readDirNames: () => [],
    isDirectory: () => true,
  };
}

function baseOptions(calls: string[], over: Partial<PortfolioProvisionOptions> = {}): PortfolioProvisionOptions {
  return {
    portfolio: 'TESTPORT',
    iteration: ITERATION,
    dependsOn: [],
    projectsDir: PROJECTS_DIR,
    port: makePort({}, calls),
    fs: makeFs([ROOT_DOC]),
    mkdir: vi.fn(() => calls.push('mkdir')),
    rmdir: vi.fn(() => calls.push('rmdir')),
    ...over,
  };
}

describe('portfolioProvision — first provision', () => {
  it('writes mkdir, then addMember, then recordDependency, in that order', () => {
    const calls: string[] = [];
    const port = makePort({ nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: 'ITER-01', kind: 'project' }] }, calls);
    portfolioProvision(baseOptions(calls, { port, dependsOn: ['ITER-01'] }));
    expect(calls).toEqual(['mkdir', 'addMember', 'recordDependency']);
  });

  it('reads the graph snapshot before the directory is created', () => {
    const calls: string[] = [];
    const port = makePort({ traceReads: true }, calls);
    portfolioProvision(baseOptions(calls, { port }));
    expect(calls).toEqual(['getGraph', 'mkdir', 'addMember']);
  });

  it('returns the full result shape, with the last write\'s revision', () => {
    const calls: string[] = [];
    const port = makePort({ nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: 'ITER-01', kind: 'project' }] }, calls);
    const result = portfolioProvision(baseOptions(calls, { port, dependsOn: ['ITER-01'] }));
    expect(result).toEqual({
      portfolio: 'TESTPORT',
      group: GROUP_ID,
      iteration: ITERATION,
      dir: DIR_PATH,
      dirCreated: true,
      membership: { status: 'recorded', rev: 2 },
      dependencies: [{ target: 'ITER-01', status: 'recorded', detail: null }],
      rev: 5,
      unresolved: [],
    });
  });

  it('records the depends-on edge from the iteration to the target', () => {
    const calls: string[] = [];
    const port = makePort({ nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: 'ITER-01', kind: 'project' }] }, calls);
    portfolioProvision(baseOptions(calls, { port, dependsOn: ['ITER-01'] }));
    expect(port.recordDependency).toHaveBeenCalledWith(ITERATION, 'ITER-01');
  });

  it('reports the membership revision when nothing else is written', () => {
    const calls: string[] = [];
    const result = portfolioProvision(baseOptions(calls));
    expect(result.rev).toBe(2);
    expect(result.membership).toEqual({ status: 'recorded', rev: 2 });
  });
});

describe('portfolioProvision — idempotent re-run', () => {
  function reRun(calls: string[], over: PortOverrides = {}, opts: Partial<PortfolioProvisionOptions> = {}) {
    const port = makePort({ members: [{ id: ROOT_DIR }, { id: ITERATION }], ...over }, calls);
    return baseOptions(calls, { port, fs: makeFs([ROOT_DOC, DIR_PATH]), ...opts });
  }

  it('writes nothing and reports every artifact as already present', () => {
    const calls: string[] = [];
    const result = portfolioProvision(reRun(calls, {
      nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: 'ITER-01', kind: 'project' }],
      edges: [{ type: 'depends-on', from: ITERATION, to: 'ITER-01' }],
    }, { dependsOn: ['ITER-01'] }));

    expect(calls).toEqual([]);
    expect(result.dirCreated).toBe(false);
    expect(result.membership).toEqual({ status: 'already-present', rev: null });
    expect(result.dependencies.map((d) => d.status)).toEqual(['already-present']);
    expect(result.rev).toBeNull();
  });

  it('records only the edge that was previously unresolved', () => {
    const calls: string[] = [];
    const opts = reRun(calls, {
      nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: 'ITER-01', kind: 'project' }, { id: 'ITER-03', kind: 'project' }],
      edges: [{ type: 'depends-on', from: ITERATION, to: 'ITER-01' }],
    }, { dependsOn: ['ITER-01', 'ITER-03'] });
    const result = portfolioProvision(opts);

    expect(calls).toEqual(['recordDependency']);
    expect(opts.port.recordDependency).toHaveBeenCalledWith(ITERATION, 'ITER-03');
    expect(result.dependencies.map((d) => d.status)).toEqual(['already-present', 'recorded']);
    expect(result.rev).toBe(5);
  });
});

describe('portfolioProvision — dependency classification', () => {
  it('reports a target with no project node as unresolved without failing the call', () => {
    const calls: string[] = [];
    const port = makePort({ nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: 'ITER-01', kind: 'project' }] }, calls);
    const opts = baseOptions(calls, { port, dependsOn: ['ITER-01', 'LATER-ONE'] });
    const result = portfolioProvision(opts);

    expect(calls).toEqual(['mkdir', 'addMember', 'recordDependency']);
    expect(port.recordDependency).toHaveBeenCalledTimes(1);
    expect(result.unresolved).toEqual(['LATER-ONE']);
    expect(result.dependencies.map((d) => d.status)).toEqual(['recorded', 'unresolved']);
    expect(result.dependencies[1]?.detail).toBeTruthy();
    // An unresolved target is a forward reference, never a rollback trigger.
    expect(opts.rmdir).not.toHaveBeenCalled();
    expect(port.removeMember).not.toHaveBeenCalled();
    expect(result.dirCreated).toBe(true);
  });

  it('records nothing for a target naming the iteration itself', () => {
    const calls: string[] = [];
    const port = makePort({ nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: ITERATION, kind: 'project' }] }, calls);
    const result = portfolioProvision(baseOptions(calls, { port, dependsOn: [ITERATION] }));

    expect(calls).toEqual(['mkdir', 'addMember']);
    expect(result.dependencies.map((d) => d.status)).toEqual(['self']);
    expect(result.dependencies[0]?.detail).toBeTruthy();
    expect(result.unresolved).toEqual([]);
  });

  it('collapses a target named twice into one edge, so a repeated name cannot fail the call', () => {
    const calls: string[] = [];
    const port = makePort({ nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: 'ITER-01', kind: 'project' }] }, calls);
    const result = portfolioProvision(baseOptions(calls, { port, dependsOn: ['ITER-01', 'ITER-01'] }));

    expect(calls).toEqual(['mkdir', 'addMember', 'recordDependency']);
    expect(result.dependencies.map((d) => d.target)).toEqual(['ITER-01']);
  });
});

describe('portfolioProvision — pre-validation', () => {
  it.each([
    ['a forward slash', 'ITER/01'],
    ['a backslash', 'ITER\\01'],
    ['a traversal segment', '..'],
    ['a nested traversal', 'A-01/../../ESCAPE'],
    ['an absolute path', path.resolve(path.sep, 'tmp', 'ITER-01')],
    ['a lowercase name', 'iter-01'],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('rejects an iteration with %s, naming the value and creating nothing', (_label, iteration) => {
    const calls: string[] = [];
    const opts = baseOptions(calls, { iteration });
    let caught: unknown;
    try { portfolioProvision(opts); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(UserError);
    if (iteration.trim()) expect((caught as Error).message).toContain(iteration);
    expect(calls).toEqual([]);
    expect(opts.mkdir).not.toHaveBeenCalled();
  });

  it.each(['../OTHER', 'a/b', 'a\\b'])('rejects a path-like --portfolio (%s) rather than relying on the resolver to fail closed', (portfolio) => {
    const calls: string[] = [];
    const opts = baseOptions(calls, { portfolio });
    expect(() => portfolioProvision(opts)).toThrow(UserError);
    expect(calls).toEqual([]);
    expect(opts.mkdir).not.toHaveBeenCalled();
  });

  it('rejects an empty --portfolio', () => {
    const calls: string[] = [];
    expect(() => portfolioProvision(baseOptions(calls, { portfolio: '  ' }))).toThrow(UserError);
    expect(calls).toEqual([]);
  });

  it('rejects a --portfolio that resolves to no portfolio at all', () => {
    const calls: string[] = [];
    const port = makePort({ groups: [] }, calls);
    const opts = baseOptions(calls, { port, portfolio: 'NOSUCH' });
    expect(() => portfolioProvision(opts)).toThrow(UserError);
    expect(opts.mkdir).not.toHaveBeenCalled();
  });

  it('rejects a portfolio whose root belongs to no group, since membership cannot be registered', () => {
    const calls: string[] = [];
    // No group matches, but the root directory does — resolution succeeds with a null group.
    const port = makePort({ groups: [] }, calls);
    const opts = baseOptions(calls, {
      port,
      fs: { ...makeFs([ROOT_DOC]), readDirNames: () => [ROOT_DIR] },
    });
    let caught: unknown;
    try { portfolioProvision(opts); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(UserError);
    expect((caught as Error).message).toMatch(/group/);
    expect(opts.mkdir).not.toHaveBeenCalled();
  });
});

describe('portfolioProvision — rollback undoes only what this call created', () => {
  it('removes the directory when membership fails on a first provision', () => {
    const calls: string[] = [];
    const port = makePort({ addMember: () => ({ ok: false, error: { code: 'validation', message: 'no such project' } }) }, calls);
    const opts = baseOptions(calls, { port });
    let caught: unknown;
    try { portfolioProvision(opts); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(UserError);
    expect(calls).toEqual(['mkdir', 'addMember', 'rmdir']);
    expect((caught as Error).message).toContain(ITERATION);
    expect(port.removeMember).not.toHaveBeenCalled();
  });

  it('leaves a pre-existing directory in place when membership fails on a re-run', () => {
    const calls: string[] = [];
    const port = makePort({ addMember: () => ({ ok: false, error: { code: 'validation', message: 'edge exists' } }) }, calls);
    const opts = baseOptions(calls, { port, fs: makeFs([ROOT_DOC, DIR_PATH]) });
    expect(() => portfolioProvision(opts)).toThrow(UserError);
    expect(calls).toEqual(['addMember']);
    expect(opts.rmdir).not.toHaveBeenCalled();
    expect(opts.mkdir).not.toHaveBeenCalled();
  });

  it('classifies a stale revision on the membership write as a SystemError', () => {
    const calls: string[] = [];
    const port = makePort({ addMember: () => ({ ok: false, error: { code: 'stale_revision', message: 'graph moved' } }) }, calls);
    expect(() => portfolioProvision(baseOptions(calls, { port }))).toThrow(SystemError);
    expect(calls).toEqual(['mkdir', 'addMember', 'rmdir']);
  });

  it('unwinds the membership edge and then the directory when a dependency write fails on a first provision', () => {
    const calls: string[] = [];
    const port = makePort({
      nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: 'ITER-01', kind: 'project' }],
      recordDependency: () => ({ ok: false, error: { code: 'validation', message: 'edge exists' } }),
    }, calls);
    const opts = baseOptions(calls, { port, dependsOn: ['ITER-01'] });
    let caught: unknown;
    try { portfolioProvision(opts); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(UserError);
    expect(calls).toEqual(['mkdir', 'addMember', 'recordDependency', 'removeMember', 'rmdir']);
    expect((caught as Error).message).toContain('ITER-01');
  });

  it('removes neither the directory nor the membership when a dependency write fails on a re-run', () => {
    const calls: string[] = [];
    const port = makePort({
      members: [{ id: ROOT_DIR }, { id: ITERATION }],
      nodes: [{ id: ROOT_DIR, kind: 'project' }, { id: 'ITER-01', kind: 'project' }],
      recordDependency: () => ({ ok: false, error: { code: 'stale_revision', message: 'graph moved' } }),
    }, calls);
    const opts = baseOptions(calls, { port, dependsOn: ['ITER-01'], fs: makeFs([ROOT_DOC, DIR_PATH]) });
    expect(() => portfolioProvision(opts)).toThrow(SystemError);

    expect(calls).toEqual(['recordDependency']);
    expect(opts.rmdir).not.toHaveBeenCalled();
    expect(port.removeMember).not.toHaveBeenCalled();
  });

  it('names a rollback step that did not undo instead of claiming a clean unwind', () => {
    const calls: string[] = [];
    const port = makePort({ addMember: () => ({ ok: false, error: { code: 'validation', message: 'no such project' } }) }, calls);
    const rmdir = vi.fn(() => { calls.push('rmdir'); throw new Error('EBUSY: directory not empty'); });
    const opts = baseOptions(calls, { port, rmdir });
    let caught: unknown;
    try { portfolioProvision(opts); } catch (e) { caught = e; }

    const message = (caught as Error).message;
    expect(message).toMatch(/rollback incomplete/);
    expect(message).toMatch(/FAILED to remove/);
    expect(message).not.toMatch(/rolled back/);
  });
});

describe('splitDependsOn', () => {
  it('splits on commas, trims, and drops empties', () => {
    expect(splitDependsOn(' ITER-01 , ITER-02 ,, ')).toEqual(['ITER-01', 'ITER-02']);
  });

  it('returns an empty list for an omitted or empty flag', () => {
    expect(splitDependsOn(undefined)).toEqual([]);
    expect(splitDependsOn('')).toEqual([]);
  });
});
