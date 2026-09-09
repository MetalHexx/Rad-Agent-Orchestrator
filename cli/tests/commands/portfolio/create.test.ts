import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { portfolioCreate } from '../../../src/commands/portfolio/create.js';
import type { PortfolioCreateOptions } from '../../../src/commands/portfolio/create.js';
import { SystemError, UserError } from '../../../src/framework/errors.js';
import type { GraphPort } from '../../../src/commands/portfolio/graph-port.js';

const PROJECTS_DIR = path.join('root', 'projects');
const DIR_PATH = path.join(PROJECTS_DIR, 'TESTPORT-ROOT');

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: 'validation' | 'stale_revision'; message: string } };

interface PortOverrides {
  groups?: { id: string; name: string }[];
  createGroup?: (name: string, description: string) => Result<{ node: { id: string; kind: 'group'; name: string; description: string }; rev: number }>;
  addMember?: (groupId: string, projectId: string) => Result<{ edge: { type: 'contains'; from: string; to: string }; rev: number }>;
  removeMember?: (groupId: string, projectId: string) => Result<{ rev: number }>;
  deleteGroup?: (groupId: string) => Result<{ rev: number }>;
}

/** A `GraphPort` stub that records every mutating call (in order) to `calls`. */
function makePort(overrides: PortOverrides, calls: string[]): GraphPort {
  const createGroup = vi.fn((name: string, description: string) => {
    calls.push('createGroup');
    return overrides.createGroup
      ? overrides.createGroup(name, description)
      : { ok: true as const, data: { node: { id: `group:${name.toLowerCase()}`, kind: 'group' as const, name, description }, rev: 1 } };
  });
  const addMember = vi.fn((groupId: string, projectId: string) => {
    calls.push('addMember');
    return overrides.addMember
      ? overrides.addMember(groupId, projectId)
      : { ok: true as const, data: { edge: { type: 'contains' as const, from: groupId, to: projectId }, rev: 2 } };
  });
  const deleteGroup = vi.fn((groupId: string) => {
    calls.push('deleteGroup');
    return overrides.deleteGroup ? overrides.deleteGroup(groupId) : { ok: true as const, data: { rev: 3 } };
  });
  const removeMember = vi.fn((groupId: string, projectId: string) => {
    calls.push('removeMember');
    return overrides.removeMember ? overrides.removeMember(groupId, projectId) : { ok: true as const, data: { rev: 4 } };
  });
  return {
    listGroups: () => overrides.groups ?? [],
    listMembers: () => [],
    getGraph: () => ({ schema: 'work-graph/v1', nodes: [], edges: [], danglingEdges: [] }),
    createGroup,
    deleteGroup,
    addMember,
    removeMember,
  } as unknown as GraphPort;
}

function baseOptions(calls: string[], over: Partial<PortfolioCreateOptions> = {}): PortfolioCreateOptions {
  return {
    base: 'TESTPORT',
    description: 'A throwaway',
    projectsDir: PROJECTS_DIR,
    port: makePort({}, calls),
    exists: vi.fn(() => false),
    mkdir: vi.fn(() => calls.push('mkdir')),
    rmdir: vi.fn(() => calls.push('rmdir')),
    ...over,
  };
}

describe('portfolioCreate — happy path', () => {
  it('writes mkdir, then createGroup, then addMember, in that order', () => {
    const calls: string[] = [];
    const opts = baseOptions(calls);
    portfolioCreate(opts);
    expect(calls).toEqual(['mkdir', 'createGroup', 'addMember']);
  });

  it('returns the final graph revision (addMember\'s, not createGroup\'s)', () => {
    const calls: string[] = [];
    const result = portfolioCreate(baseOptions(calls));
    expect(result.rev).toBe(2);
  });

  it('returns name, group, dir, five doc paths, and the fixed write list', () => {
    const calls: string[] = [];
    const result = portfolioCreate(baseOptions(calls));
    expect(result.name).toBe('TESTPORT');
    expect(result.group).toBe('group:testport');
    expect(result.dir).toBe(DIR_PATH);
    expect(Object.keys(result.docs).sort()).toEqual(['decisions', 'groundTruth', 'iterations', 'root', 'technical'].sort());
    expect(result.write).toEqual(['root', 'decisions']);
  });

  it('never calls a rollback verb when every write succeeds', () => {
    const calls: string[] = [];
    const opts = baseOptions(calls);
    portfolioCreate(opts);
    expect(opts.port.deleteGroup).not.toHaveBeenCalled();
    expect(opts.port.removeMember).not.toHaveBeenCalled();
    expect(opts.rmdir).not.toHaveBeenCalled();
  });
});

describe('portfolioCreate — pre-validation', () => {
  it('rejects a non-empty-after-trim-failing description before touching anything', () => {
    const calls: string[] = [];
    const opts = baseOptions(calls, { description: '   ' });
    expect(() => portfolioCreate(opts)).toThrow(UserError);
    expect(calls).toEqual([]);
    expect(opts.exists).not.toHaveBeenCalled();
  });

  it.each(['RAD.ORC', 'RAD--ORC', 'RAD-', 'radorc', 'RAD ORC'])('rejects %s under the round-trip name rule, calling no stub', (base) => {
    const calls: string[] = [];
    const opts = baseOptions(calls, { base });
    expect(() => portfolioCreate(opts)).toThrow(UserError);
    expect(calls).toEqual([]);
    expect(opts.exists).not.toHaveBeenCalled();
  });

  it('names the accepted shape in the rejection message', () => {
    const calls: string[] = [];
    expect(() => portfolioCreate(baseOptions(calls, { base: 'RAD.ORC' }))).toThrow(/A-Z0-9/);
  });

  it('rejects an existing directory as a collision, without calling any port method', () => {
    const calls: string[] = [];
    const opts = baseOptions(calls, { exists: vi.fn((p: string) => p === DIR_PATH) });
    expect(() => portfolioCreate(opts)).toThrow(UserError);
    expect(calls).toEqual([]);
  });

  it('collides on a group matched by id (group:testport), calling no stub', () => {
    const calls: string[] = [];
    const port = makePort({ groups: [{ id: 'group:testport', name: 'Unrelated Name' }] }, calls);
    const opts = baseOptions(calls, { port });
    expect(() => portfolioCreate(opts)).toThrow(UserError);
    expect(calls).toEqual([]);
  });

  it('collides on a group matched by name (TESTPORT), calling no stub', () => {
    const calls: string[] = [];
    const port = makePort({ groups: [{ id: 'group:unrelated', name: 'TESTPORT' }] }, calls);
    const opts = baseOptions(calls, { port });
    expect(() => portfolioCreate(opts)).toThrow(UserError);
    expect(calls).toEqual([]);
  });

  it('collides via the shared matchesGroup predicate even when id and name differ in case from base — a two-way id-or-name check would miss this', () => {
    const calls: string[] = [];
    const port = makePort({ groups: [{ id: 'group:testport', name: 'TestPort' }] }, calls);
    const opts = baseOptions(calls, { port });
    expect(() => portfolioCreate(opts)).toThrow(UserError);
    expect(calls).toEqual([]);
  });

  it('names the exact id/slug match in the collision message even when an unrelated group\'s display name also matches, regardless of list order', () => {
    // group:unrelated's display name has drifted to coincidentally equal
    // 'TESTPORT' — the real, id-minting collision (group:testport) must still be
    // the one named, no matter which group `listGroups()` returns first.
    const idMatch = { id: 'group:testport', name: 'Something Else' };
    const nameMatch = { id: 'group:unrelated', name: 'TESTPORT' };
    for (const groups of [[idMatch, nameMatch], [nameMatch, idMatch]]) {
      const calls: string[] = [];
      const port = makePort({ groups }, calls);
      const opts = baseOptions(calls, { port });
      let caught: unknown;
      try { portfolioCreate(opts); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(UserError);
      expect((caught as Error).message).toContain('group:testport');
      expect(calls).toEqual([]);
    }
  });
});

describe('portfolioCreate — rollback', () => {
  it('mkdir throwing calls no port method and no rmdir of something never made', () => {
    const calls: string[] = [];
    const mkdir = vi.fn(() => { throw new Error('disk full'); });
    const opts = baseOptions(calls, { mkdir });
    expect(() => portfolioCreate(opts)).toThrow(SystemError);
    expect(calls).toEqual([]);
    expect(opts.port.createGroup).not.toHaveBeenCalled();
    expect(opts.rmdir).not.toHaveBeenCalled();
  });

  it('createGroup rejecting the input rolls back the directory and throws UserError, naming the step and what was undone', () => {
    const calls: string[] = [];
    const port = makePort({ createGroup: () => ({ ok: false, error: { code: 'validation', message: 'duplicate slug' } }) }, calls);
    const opts = baseOptions(calls, { port });
    let caught: unknown;
    try { portfolioCreate(opts); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UserError);
    expect((caught as Error).message).toMatch(/group:testport/);
    expect((caught as Error).message).toMatch(/TESTPORT-ROOT/);
    expect(calls).toEqual(['mkdir', 'createGroup', 'rmdir']);
    expect(port.deleteGroup).not.toHaveBeenCalled();
    expect(port.addMember).not.toHaveBeenCalled();
  });

  it('createGroup failing on a stale revision performs the same rollback but throws SystemError', () => {
    const calls: string[] = [];
    const port = makePort({ createGroup: () => ({ ok: false, error: { code: 'stale_revision', message: 'graph moved' } }) }, calls);
    const opts = baseOptions(calls, { port });
    expect(() => portfolioCreate(opts)).toThrow(SystemError);
    expect(calls).toEqual(['mkdir', 'createGroup', 'rmdir']);
    expect(port.deleteGroup).not.toHaveBeenCalled();
  });

  it('addMember failing rolls back the edge, then the group, then the directory, in that order', () => {
    const calls: string[] = [];
    const port = makePort({ addMember: () => ({ ok: false, error: { code: 'validation', message: 'edge exists' } }) }, calls);
    const opts = baseOptions(calls, { port });
    let caught: unknown;
    try { portfolioCreate(opts); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UserError);
    expect((caught as Error).message).toMatch(/group:testport/);
    expect((caught as Error).message).toMatch(/TESTPORT-ROOT/);
    expect(calls).toEqual(['mkdir', 'createGroup', 'addMember', 'removeMember', 'deleteGroup', 'rmdir']);
  });

  it('addMember failing on a stale revision throws SystemError with the same rollback order', () => {
    const calls: string[] = [];
    const port = makePort({ addMember: () => ({ ok: false, error: { code: 'stale_revision', message: 'graph moved' } }) }, calls);
    const opts = baseOptions(calls, { port });
    expect(() => portfolioCreate(opts)).toThrow(SystemError);
    expect(calls).toEqual(['mkdir', 'createGroup', 'addMember', 'removeMember', 'deleteGroup', 'rmdir']);
  });
});

describe('portfolioCreate — rollback failure is reported, never hidden', () => {
  it('a rmdir that throws during a single-step rollback is named as failed, not claimed as a clean rollback', () => {
    const calls: string[] = [];
    const port = makePort({ createGroup: () => ({ ok: false, error: { code: 'validation', message: 'duplicate slug' } }) }, calls);
    const rmdir = vi.fn(() => { calls.push('rmdir'); throw new Error('EBUSY: directory not empty'); });
    const opts = baseOptions(calls, { port, rmdir });
    let caught: unknown;
    try { portfolioCreate(opts); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UserError);
    const message = (caught as Error).message;
    expect(message).toMatch(/rollback incomplete/);
    expect(message).toMatch(/FAILED to remove TESTPORT-ROOT\/ \(EBUSY: directory not empty\)/);
    expect(message).not.toMatch(/rolled back/);
  });

  it('removeMember throwing does not stop deleteGroup or the directory rollback from being attempted, and names only the failed step', () => {
    const calls: string[] = [];
    const port = makePort({
      addMember: () => ({ ok: false, error: { code: 'validation', message: 'edge exists' } }),
      removeMember: () => { throw new Error('graph locked'); },
    }, calls);
    const opts = baseOptions(calls, { port });
    let caught: unknown;
    try { portfolioCreate(opts); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UserError);
    // Every step still runs despite the first one throwing.
    expect(calls).toEqual(['mkdir', 'createGroup', 'addMember', 'removeMember', 'deleteGroup', 'rmdir']);
    const message = (caught as Error).message;
    expect(message).toMatch(/rollback incomplete/);
    expect(message).toMatch(/FAILED to remove the edge \(graph locked\)/);
    expect(message).toMatch(/removed group:testport/);
    expect(message).toMatch(/removed TESTPORT-ROOT\//);
  });

  it('a non-throwing {ok: false} from deleteGroup is inspected and reported, not silently treated as success', () => {
    const calls: string[] = [];
    const port = makePort({
      addMember: () => ({ ok: false, error: { code: 'validation', message: 'edge exists' } }),
      deleteGroup: () => ({ ok: false, error: { code: 'stale_revision', message: 'graph moved under us' } }),
    }, calls);
    const opts = baseOptions(calls, { port });
    let caught: unknown;
    try { portfolioCreate(opts); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UserError);
    expect(calls).toEqual(['mkdir', 'createGroup', 'addMember', 'removeMember', 'deleteGroup', 'rmdir']);
    const message = (caught as Error).message;
    expect(message).toMatch(/rollback incomplete/);
    expect(message).toMatch(/FAILED to remove group:testport \(graph moved under us\)/);
    expect(message).toMatch(/removed the edge/);
    expect(message).toMatch(/removed TESTPORT-ROOT\//);
  });
});
