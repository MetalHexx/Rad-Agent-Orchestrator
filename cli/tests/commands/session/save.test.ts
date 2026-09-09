import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionSave, type SessionSaveOptions } from '../../../src/commands/session/save.js';
import { readProjectSessions, upsertProjectSession } from '../../../src/lib/project-sessions.js';
import { lookupSessionProject, readProjectIndex, writeProjectIndexEntry, computeActiveTimeMs } from '@rad-orchestration/telemetry';

let root: string;
let projectsRoot: string;
let telemetryRoot: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-save-'));
  projectsRoot = path.join(root, 'projects');
  telemetryRoot = path.join(root, 'telemetry');
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.mkdirSync(telemetryRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function ensureProjectDir(dir: string): boolean {
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  return true;
}

function baseOpts(over: Partial<SessionSaveOptions> = {}): SessionSaveOptions {
  return {
    project: 'AIOPS-1',
    sessionId: 'sess-1',
    description: 'did some work',
    harness: 'claude',
    name: 'My Session',
    cwd: '/wherever',
    projectsRoot,
    telemetryRoot,
    ensureProjectDir,
    readProjectSessions,
    upsertProjectSession,
    lookupSessionProject,
    writeProjectIndexEntry,
    computeActiveTimeMs,
    now: () => new Date('2026-08-28T00:00:00.000Z'),
    ...over,
  };
}

describe('sessionSave', () => {
  it('creates the project folder, writes the record and index entry, and reports projectCreated', () => {
    const r = sessionSave(baseOpts());
    expect(r.conflict).toBeUndefined();
    expect(r.created).toBe(true);
    expect(r.projectCreated).toBe(true);
    expect(r.name).toBe('My Session');
    expect(r.activityCount).toBe(1);
    expect(r.activeTimeMs).toBe(0);

    expect(fs.existsSync(path.join(projectsRoot, 'AIOPS-1'))).toBe(true);
    expect(fs.existsSync(path.join(projectsRoot, 'AIOPS-1', 'phases'))).toBe(false);
    expect(fs.existsSync(path.join(projectsRoot, 'AIOPS-1', 'tasks'))).toBe(false);
    expect(fs.existsSync(path.join(projectsRoot, 'AIOPS-1', 'reports'))).toBe(false);
    expect(fs.existsSync(path.join(projectsRoot, 'AIOPS-1', 'state.json'))).toBe(false);
    expect(lookupSessionProject(telemetryRoot, 'sess-1')).toBe('AIOPS-1');
  });

  it('appends an activity entry on a second save and reports created: false', () => {
    sessionSave(baseOpts());
    const r = sessionSave(baseOpts({ description: 'did more work', name: undefined }));
    expect(r.created).toBe(false);
    expect(r.projectCreated).toBe(false);
    expect(r.activityCount).toBe(2);
  });

  it('returns the conflict and writes nothing when the session is attributed to a different project', () => {
    sessionSave(baseOpts());
    const before = fs.readFileSync(path.join(projectsRoot, 'AIOPS-1', '.project-sessions.json'), 'utf8');

    const r = sessionSave(baseOpts({ project: 'AIOPS-2', name: 'Other' }));
    expect(r.conflict).toMatchObject({ sessionId: 'sess-1', existingProject: 'AIOPS-1', requestedProject: 'AIOPS-2' });
    expect(r.conflict?.message).toBeTruthy();
    expect(r.conflict?.message).toContain('AIOPS-1');
    expect(r.conflict?.message).toContain('AIOPS-2');
    expect(r.name).toBeUndefined();
    expect(r.created).toBeUndefined();
    expect(r.projectCreated).toBeUndefined();

    expect(fs.existsSync(path.join(projectsRoot, 'AIOPS-2'))).toBe(false);
    const after = fs.readFileSync(path.join(projectsRoot, 'AIOPS-1', '.project-sessions.json'), 'utf8');
    expect(after).toBe(before);
    expect(lookupSessionProject(telemetryRoot, 'sess-1')).toBe('AIOPS-1');
  });

  it('proceeds and re-points the index when the claimed project folder is gone', () => {
    sessionSave(baseOpts());
    fs.rmSync(path.join(projectsRoot, 'AIOPS-1'), { recursive: true, force: true });

    const r = sessionSave(baseOpts({ project: 'AIOPS-2', name: 'Other' }));
    expect(r.conflict).toBeUndefined();
    expect(r.created).toBe(true);
    expect(r.projectCreated).toBe(true);

    expect(readProjectSessions(path.join(projectsRoot, 'AIOPS-2')).sessions).toHaveLength(1);
    expect(lookupSessionProject(telemetryRoot, 'sess-1')).toBe('AIOPS-2');
  });

  it('proceeds and re-points the index when the claimed project folder no longer lists the session', () => {
    sessionSave(baseOpts());
    const recordPath = path.join(projectsRoot, 'AIOPS-1', '.project-sessions.json');
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    record.sessions = [];
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf8');

    const r = sessionSave(baseOpts({ project: 'AIOPS-2', name: 'Other' }));
    expect(r.conflict).toBeUndefined();
    expect(r.created).toBe(true);

    expect(readProjectSessions(path.join(projectsRoot, 'AIOPS-2')).sessions).toHaveLength(1);
    expect(lookupSessionProject(telemetryRoot, 'sess-1')).toBe('AIOPS-2');
  });

  it('treats a malformed claim as stale and proceeds', () => {
    const r = sessionSave(baseOpts({ lookupSessionProject: () => '../escape' }));
    expect(r.conflict).toBeUndefined();
    expect(r.created).toBe(true);
    expect(lookupSessionProject(telemetryRoot, 'sess-1')).toBe('AIOPS-1');
  });

  it('fails with a name-required message when creating without --name', () => {
    expect(() => sessionSave(baseOpts({ name: undefined }))).toThrow(/name is required/i);
    expect(fs.existsSync(path.join(projectsRoot, 'AIOPS-1'))).toBe(false);
  });

  it('fails with a name-required message when creating with a whitespace-only --name, before any directory is created', () => {
    expect(() => sessionSave(baseOpts({ name: '   ' }))).toThrow(/name is required/i);
    expect(fs.existsSync(path.join(projectsRoot, 'AIOPS-1'))).toBe(false);
  });

  it('rejects a malformed --project before any directory is created', () => {
    expect(() => sessionSave(baseOpts({ project: 'aiops-1' }))).toThrow(/valid project directory name/i);
    expect(fs.existsSync(path.join(projectsRoot, 'aiops-1'))).toBe(false);
  });

  it('rejects a traversal-shaped --project before any directory is created', () => {
    expect(() => sessionSave(baseOpts({ project: '../escape' }))).toThrow(/valid project directory name/i);
    expect(fs.existsSync(path.join(root, 'escape'))).toBe(false);
  });

  it('rejects an empty --session before any directory is created', () => {
    expect(() => sessionSave(baseOpts({ sessionId: '' }))).toThrow(/non-empty session ID/i);
    expect(() => sessionSave(baseOpts({ sessionId: '   ' }))).toThrow(/non-empty session ID/i);
    expect(fs.existsSync(path.join(projectsRoot, 'AIOPS-1'))).toBe(false);
  });

  it('stamps the record and the telemetry index from one injected clock read', () => {
    sessionSave(baseOpts());

    const entry = readProjectIndex(telemetryRoot).sessions.find((s) => s.sessionId === 'sess-1');
    expect(entry?.updatedAt).toBe('2026-08-28T00:00:00.000Z');
    const file = readProjectSessions(path.join(projectsRoot, 'AIOPS-1'));
    expect(file.sessions[0]!.lastSeenAt).toBe(entry?.updatedAt);
  });

  it('rejects an unrecognized --harness enumerating both accepted values', () => {
    expect(() => sessionSave(baseOpts({ harness: 'gpt' }))).toThrow(/claude.*copilot|copilot.*claude/i);
  });

  it('accepts and stores an unrecognized --type', () => {
    const r = sessionSave(baseOpts({ type: 'not-a-real-type' }));
    expect(r.type).toBe('not-a-real-type');
    const file = readProjectSessions(path.join(projectsRoot, 'AIOPS-1'));
    expect(file.sessions[0]!.activity[0]!.type).toBe('not-a-real-type');
  });

  it('surfaces an index write failure as a system error naming the failed write', () => {
    const failingWrite = () => { throw new Error('disk full'); };
    expect(() => sessionSave(baseOpts({ writeProjectIndexEntry: failingWrite }))).toThrow(/index/i);
    // The record itself is not rolled back.
    const file = readProjectSessions(path.join(projectsRoot, 'AIOPS-1'));
    expect(file.sessions).toHaveLength(1);
  });
});
