import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionList, type SessionListOptions } from '../../../src/commands/session/list.js';
import { readProjectSessions, upsertProjectSession } from '../../../src/lib/project-sessions.js';

let root: string;
let projectsRoot: string;
let telemetryRoot: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-list-'));
  projectsRoot = path.join(root, 'projects');
  telemetryRoot = path.join(root, 'telemetry');
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.mkdirSync(telemetryRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function seed(project: string, sessionId: string, at: string, type: string, name = sessionId): void {
  const dir = path.join(projectsRoot, project);
  fs.mkdirSync(dir, { recursive: true });
  upsertProjectSession(dir, {
    sessionId,
    name,
    cwd: '/wherever',
    harness: 'claude',
    activity: { type, description: `activity for ${sessionId}` },
    now: new Date(at),
  });
}

function baseOpts(over: Partial<SessionListOptions> = {}): SessionListOptions {
  return {
    project: 'AIOPS-1',
    cwd: '/wherever',
    projectsRoot,
    telemetryRoot,
    readProjectSessions,
    computeActiveTimeMs: () => 0,
    ...over,
  };
}

describe('sessionList', () => {
  it('returns rows newest-first by lastSeenAt', () => {
    seed('AIOPS-1', 'a', '2026-08-01T00:00:00.000Z', 'other');
    seed('AIOPS-1', 'b', '2026-08-03T00:00:00.000Z', 'other');
    seed('AIOPS-1', 'c', '2026-08-02T00:00:00.000Z', 'other');

    const r = sessionList(baseOpts());
    expect(r.rows.map((row) => row.sessionId)).toEqual(['b', 'c', 'a']);
    expect(r.total).toBe(3);
  });

  it('honours --type, matching a session whose trail includes the type anywhere', () => {
    seed('AIOPS-1', 'a', '2026-08-01T00:00:00.000Z', 'brainstorming');
    seed('AIOPS-1', 'b', '2026-08-02T00:00:00.000Z', 'execution');

    const r = sessionList(baseOpts({ type: 'brainstorming' }));
    expect(r.rows.map((row) => row.sessionId)).toEqual(['a']);
    expect(r.total).toBe(1);
  });

  it('matches a pipeline-written activity type and excludes it from an unrelated filter', () => {
    seed('AIOPS-1', 'a', '2026-08-01T00:00:00.000Z', 'halted');
    seed('AIOPS-1', 'b', '2026-08-02T00:00:00.000Z', 'execution');

    const halted = sessionList(baseOpts({ type: 'halted' }));
    expect(halted.rows.map((row) => row.sessionId)).toEqual(['a']);
    expect(halted.total).toBe(1);

    const execution = sessionList(baseOpts({ type: 'execution' }));
    expect(execution.rows.map((row) => row.sessionId)).toEqual(['b']);
    expect(execution.total).toBe(1);
  });

  it('defaults to ten rows and returns everything under --all', () => {
    for (let i = 0; i < 12; i++) {
      seed('AIOPS-1', `s${i}`, `2026-08-01T00:${String(i).padStart(2, '0')}:00.000Z`, 'other');
    }
    const limited = sessionList(baseOpts());
    expect(limited.rows).toHaveLength(10);
    expect(limited.total).toBe(12);

    const all = sessionList(baseOpts({ all: true }));
    expect(all.rows).toHaveLength(12);
  });

  it('computes per-row active time only for the rows the limit returns', () => {
    for (let i = 0; i < 12; i++) {
      seed('AIOPS-1', `s${i}`, `2026-08-01T00:${String(i).padStart(2, '0')}:00.000Z`, 'other');
    }

    // s0 and s1 are the two oldest and fall outside the default limit-10 page
    // (sorted newest-first); giving only them a nonzero value proves no row
    // reflects a session the limit excluded.
    const r = sessionList(baseOpts({
      computeActiveTimeMs: ({ sessionId }) => (sessionId === 's0' || sessionId === 's1' ? 5 : 0),
    }));

    expect(r.rows).toHaveLength(10);
    expect(r.rows.every((row) => row.activeTimeMs === 0)).toBe(true);
  });

  it('sums totalActiveTimeMs across every matching session, independent of --limit', () => {
    for (let i = 0; i < 12; i++) {
      seed('AIOPS-1', `s${i}`, `2026-08-01T00:${String(i).padStart(2, '0')}:00.000Z`, 'other');
    }

    const withLimit = sessionList(baseOpts({
      limit: 1,
      computeActiveTimeMs: ({ sessionId }) => Number(sessionId.slice(1)) + 1,
    }));
    const withAll = sessionList(baseOpts({
      all: true,
      computeActiveTimeMs: ({ sessionId }) => Number(sessionId.slice(1)) + 1,
    }));

    const expectedTotal = Array.from({ length: 12 }, (_, i) => i + 1).reduce((a, b) => a + b, 0);
    expect(withLimit.rows).toHaveLength(1);
    expect(withAll.rows).toHaveLength(12);
    expect(withLimit.totalActiveTimeMs).toBe(expectedTotal);
    expect(withAll.totalActiveTimeMs).toBe(expectedTotal);
  });

  it('a session with no telemetry contributes zero to the total without erroring', () => {
    seed('AIOPS-1', 'a', '2026-08-01T00:00:00.000Z', 'other');
    seed('AIOPS-1', 'b', '2026-08-02T00:00:00.000Z', 'other');

    const r = sessionList(baseOpts({
      computeActiveTimeMs: ({ sessionId }) => (sessionId === 'a' ? 42 : 0),
    }));

    expect(r.totalActiveTimeMs).toBe(42);
  });

  it('resolves the project from cwd via the locator when --project is absent', () => {
    seed('AIOPS-9', 'x', '2026-08-01T00:00:00.000Z', 'other');

    const r = sessionList(baseOpts({
      project: undefined,
      locator: () => ({ kind: 'side-project', worktree_name: 'AIOPS-9' }),
    }));
    expect(r.project).toBe('AIOPS-9');
    expect(r.rows.map((row) => row.sessionId)).toEqual(['x']);
  });

  it('returns an actionable user error for a main-clone cwd with no --project', () => {
    expect(() => sessionList(baseOpts({
      project: undefined,
      locator: () => ({ kind: 'main-clone', repo: 'rad-orc-source', branch: 'main' }),
    }))).toThrow(/--project/);
  });

  it('rejects a traversal-shaped --project before any path is read', () => {
    expect(() => sessionList(baseOpts({ project: '../escape' }))).toThrow(/valid project directory name/i);
  });
});
