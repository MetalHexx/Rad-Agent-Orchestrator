import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { readSavedIndex, isSessionSaved, type SavedSessionsIndex } from '../src/saved-sessions.js';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'saved-')); }

it('returns a valid empty index when none exists (FR-11, NFR-4)', () => {
  const root = tmpRoot();
  const idx = readSavedIndex(root);
  expect(idx.version).toBe(1);
  expect(idx.sessions).toEqual([]);
  expect(typeof idx.updatedAt).toBe('string');
});

it('reads an existing index and tolerates unknown fields (NFR-4)', () => {
  const root = tmpRoot();
  const onDisk = { version: 1, updatedAt: '2026-06-25T00:00:00.000Z', future: 'ok',
    sessions: [{ sessionId: 's1', title: 's1', savedAt: '2026-06-25T00:00:00.000Z',
      snapshot: { worktree: null, model: null, startedAt: '', durationMs: 0, totalSpend: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        toolCalls: 0, toolErrors: 0, subagents: 0, filesTouched: 0 }, extra: 1 }] };
  fs.writeFileSync(path.join(root, '.saved-sessions.json'), JSON.stringify(onDisk));
  const idx: SavedSessionsIndex = readSavedIndex(root);
  expect(idx.sessions.map((s) => s.sessionId)).toEqual(['s1']);
  expect(isSessionSaved(root, 's1')).toBe(true);
  expect(isSessionSaved(root, 'nope')).toBe(false);
});
