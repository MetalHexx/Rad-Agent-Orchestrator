import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectSessionsPath, readProjectSessions } from './project-sessions-reader';

function seedProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-sessions-reader-'));
}

test('readProjectSessions returns an empty result when the file is absent', () => {
  const dir = seedProjectDir();
  const result = readProjectSessions(dir);
  assert.deepEqual(result, { version: 1, sessions: [], updatedAt: '' });
});

test('readProjectSessions returns an empty result for malformed JSON', () => {
  const dir = seedProjectDir();
  fs.writeFileSync(projectSessionsPath(dir), '{ not valid json', 'utf8');
  const result = readProjectSessions(dir);
  assert.deepEqual(result, { version: 1, sessions: [], updatedAt: '' });
});

test('readProjectSessions returns an empty sessions array when `sessions` is not an array', () => {
  const dir = seedProjectDir();
  fs.writeFileSync(
    projectSessionsPath(dir),
    JSON.stringify({ version: 1, sessions: 'nope', updatedAt: '2026-01-01T00:00:00.000Z' }),
    'utf8',
  );
  const result = readProjectSessions(dir);
  assert.deepEqual(result.sessions, []);
  assert.equal(result.updatedAt, '2026-01-01T00:00:00.000Z');
});

test('readProjectSessions returns the recorded entries for a well-formed file', () => {
  const dir = seedProjectDir();
  const entry = {
    sessionId: 'abc-123',
    name: 'My Session',
    cwd: path.join(dir, 'workspace'),
    harness: 'claude' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-02T00:00:00.000Z',
    activity: [{ type: 'other', description: 'did stuff', at: '2026-01-01T00:00:00.000Z' }],
  };
  fs.writeFileSync(
    projectSessionsPath(dir),
    JSON.stringify({ version: 1, sessions: [entry], updatedAt: '2026-01-02T00:00:00.000Z' }),
    'utf8',
  );
  const result = readProjectSessions(dir);
  assert.deepEqual(result.sessions, [entry]);
});
