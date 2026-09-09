import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { projectIndexPath, readProjectIndex, writeProjectIndexEntry, lookupSessionProject, removeProjectIndexEntries } from '../src/project-index.js';

function tempRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'proj-index-')); }

it('resolves a session to its project name after a write', () => {
  const root = tempRoot();
  writeProjectIndexEntry(root, { sessionId: 's1', project: 'AIOPS-330' });

  expect(lookupSessionProject(root, 's1')).toBe('AIOPS-330');
  expect(lookupSessionProject(root, 'unknown')).toBeNull();
});

it('rewrites rather than appends when the same session id is written again', () => {
  const root = tempRoot();
  writeProjectIndexEntry(root, { sessionId: 's1', project: 'FIRST' });
  writeProjectIndexEntry(root, { sessionId: 's2', project: 'OTHER' });
  const second = writeProjectIndexEntry(root, { sessionId: 's1', project: 'SECOND' });

  const index = readProjectIndex(root);
  expect(index.sessions.filter((s) => s.sessionId === 's1')).toHaveLength(1);
  expect(index.sessions).toHaveLength(2);
  expect(lookupSessionProject(root, 's1')).toBe('SECOND');
  expect(second.updatedAt).not.toBe('');
});

it('stamps updatedAt from an injected clock when one is supplied', () => {
  const root = tempRoot();
  const now = new Date('2026-08-28T00:00:00.000Z');

  const entry = writeProjectIndexEntry(root, { sessionId: 's1', project: 'AIOPS-330', now });
  expect(entry.updatedAt).toBe('2026-08-28T00:00:00.000Z');
  expect(readProjectIndex(root).updatedAt).toBe('2026-08-28T00:00:00.000Z');

  const later = new Date('2026-08-29T12:00:00.000Z');
  const rewritten = writeProjectIndexEntry(root, { sessionId: 's1', project: 'AIOPS-331', now: later });
  expect(rewritten.updatedAt).toBe('2026-08-29T12:00:00.000Z');
});

it('reads an absent or malformed index as empty', () => {
  const root = tempRoot();
  expect(readProjectIndex(root).sessions).toEqual([]);

  fs.writeFileSync(projectIndexPath(root), '{ not json', 'utf8');
  expect(readProjectIndex(root).sessions).toEqual([]);
  expect(lookupSessionProject(root, 's1')).toBeNull();

  fs.writeFileSync(projectIndexPath(root), JSON.stringify({ version: 1, sessions: 'nope' }), 'utf8');
  expect(readProjectIndex(root).sessions).toEqual([]);
});

it('creates the telemetry root directory on a fresh install before writing the index', () => {
  const root = path.join(tempRoot(), 'nested', 'telemetry');
  expect(fs.existsSync(root)).toBe(false);

  writeProjectIndexEntry(root, { sessionId: 's1', project: 'AIOPS-330' });

  expect(fs.existsSync(root)).toBe(true);
  expect(lookupSessionProject(root, 's1')).toBe('AIOPS-330');
});

it('reclaims a stale lock left behind by a crashed writer instead of hanging', () => {
  const root = tempRoot();
  const lockFile = `${projectIndexPath(root)}.lock`;
  fs.writeFileSync(lockFile, '', 'utf8');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockFile, old, old);

  const entry = writeProjectIndexEntry(root, { sessionId: 's1', project: 'AIOPS-330' });

  expect(entry.sessionId).toBe('s1');
  expect(fs.existsSync(lockFile)).toBe(false);
  expect(lookupSessionProject(root, 's1')).toBe('AIOPS-330');
});

it('does not leave a lock file behind after a successful write', () => {
  const root = tempRoot();
  writeProjectIndexEntry(root, { sessionId: 's1', project: 'AIOPS-330' });
  expect(fs.existsSync(`${projectIndexPath(root)}.lock`)).toBe(false);
});

it('removes only the entries attributed to the named project, leaving others byte-identical', () => {
  const root = tempRoot();
  writeProjectIndexEntry(root, { sessionId: 's1', project: 'AIOPS-330' });
  writeProjectIndexEntry(root, { sessionId: 's2', project: 'AIOPS-331' });
  writeProjectIndexEntry(root, { sessionId: 's3', project: 'AIOPS-330' });
  const before = readProjectIndex(root);
  const survivor = before.sessions.find((s) => s.sessionId === 's2');

  const removed = removeProjectIndexEntries(root, 'AIOPS-330');

  expect(removed).toBe(2);
  const after = readProjectIndex(root);
  expect(after.sessions).toHaveLength(1);
  expect(after.sessions[0]).toEqual(survivor);
  expect(lookupSessionProject(root, 's1')).toBeNull();
  expect(lookupSessionProject(root, 's3')).toBeNull();
  expect(lookupSessionProject(root, 's2')).toBe('AIOPS-331');
});

it('performs no write when nothing matches the project', () => {
  const root = tempRoot();
  writeProjectIndexEntry(root, { sessionId: 's1', project: 'AIOPS-331', now: new Date('2026-08-01T00:00:00.000Z') });
  const before = readProjectIndex(root);

  const removed = removeProjectIndexEntries(root, 'NO-SUCH-PROJECT');

  expect(removed).toBe(0);
  expect(readProjectIndex(root)).toEqual(before);
});

it('leaves updatedAt untouched when a project never recorded a session', () => {
  const root = tempRoot();
  writeProjectIndexEntry(root, { sessionId: 's1', project: 'AIOPS-330', now: new Date('2026-08-01T00:00:00.000Z') });

  removeProjectIndexEntries(root, 'NEVER-RECORDED');

  expect(readProjectIndex(root).updatedAt).toBe('2026-08-01T00:00:00.000Z');
});

it('degrades a malformed index to empty rather than throwing', () => {
  const root = tempRoot();
  fs.writeFileSync(projectIndexPath(root), '{ not json', 'utf8');

  expect(() => removeProjectIndexEntries(root, 'AIOPS-330')).not.toThrow();
  expect(removeProjectIndexEntries(root, 'AIOPS-330')).toBe(0);
});
