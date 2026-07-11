import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { saveSession, updateSavedSession, unsaveSession, readSavedIndex, type SavedSessionSnapshot } from '../src/saved-sessions.js';
import { PRICING_VERSION } from '../src/read/pricing.js';

const SNAP: SavedSessionSnapshot = { worktree: null, model: null, startedAt: '', durationMs: 0, totalSpend: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, toolCalls: 0, toolErrors: 0, subagents: 0, filesTouched: 0,
  harness: null, costUsd: 0, pricingVersion: PRICING_VERSION };

it('saves with title defaulting to the session id, then renames, then unsaves (FR-1, FR-5, FR-2)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
  const saved = saveSession(root, { sessionId: 's1', snapshot: SNAP });
  expect(saved.title).toBe('s1');
  expect(typeof saved.savedAt).toBe('string');
  expect(readSavedIndex(root).sessions).toHaveLength(1);

  const renamed = updateSavedSession(root, 's1', { title: 'My baseline' });
  expect(renamed.title).toBe('My baseline');
  expect(readSavedIndex(root).sessions[0].title).toBe('My baseline');

  unsaveSession(root, 's1');
  expect(readSavedIndex(root).sessions).toHaveLength(0);
});

it('saving the same session twice does not duplicate and leaves no temp file (NFR-1, AD-3)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mut2-'));
  saveSession(root, { sessionId: 's1', snapshot: SNAP });
  saveSession(root, { sessionId: 's1', snapshot: SNAP });
  expect(readSavedIndex(root).sessions).toHaveLength(1);
  expect(fs.readdirSync(root).filter((f) => f.includes('.tmp'))).toEqual([]);
});
