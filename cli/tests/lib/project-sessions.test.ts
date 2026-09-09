import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fsSyncMod from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  projectSessionsPath,
  readProjectSessions,
  upsertProjectSession,
  PROJECT_SESSIONS_FILE,
  type ProjectSessionsFile,
  type UpsertInput,
} from '../../src/lib/project-sessions.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rad-sessions-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('project-sessions', () => {
  describe('projectSessionsPath', () => {
    it('returns the correct file path', () => {
      const result = projectSessionsPath('/foo/bar');
      expect(result).toBe(path.join('/foo/bar', PROJECT_SESSIONS_FILE));
      expect(result).toContain('.project-sessions.json');
    });
  });

  describe('readProjectSessions', () => {
    it('reads a valid sessions file', async () => {
      const file = projectSessionsPath(tmpDir);
      const data: ProjectSessionsFile = {
        version: 1,
        sessions: [
          {
            sessionId: 'session-1',
            name: 'Test Session',
            cwd: '/path/to/cwd',
            harness: 'claude',
            createdAt: '2026-08-28T00:00:00Z',
            lastSeenAt: '2026-08-28T00:00:00Z',
            activity: [
              {
                type: 'brainstorming',
                description: 'Initial discussion',
                at: '2026-08-28T00:00:00Z',
              },
            ],
          },
        ],
        updatedAt: '2026-08-28T00:00:00Z',
      };
      await fs.writeFile(file, JSON.stringify(data));
      const result = readProjectSessions(tmpDir);
      expect(result.version).toBe(1);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]?.sessionId).toBe('session-1');
    });

    it('returns empty index when file does not exist', () => {
      const result = readProjectSessions(tmpDir);
      expect(result.version).toBe(1);
      expect(result.sessions).toHaveLength(0);
      expect(result.updatedAt).toBe('');
    });

    it('returns empty index when file is malformed JSON', async () => {
      const file = projectSessionsPath(tmpDir);
      await fs.writeFile(file, 'not valid json {]');
      const result = readProjectSessions(tmpDir);
      expect(result.version).toBe(1);
      expect(result.sessions).toHaveLength(0);
      expect(result.updatedAt).toBe('');
    });

    it('ignores unknown fields in the file', async () => {
      const file = projectSessionsPath(tmpDir);
      const data = {
        version: 1,
        sessions: [],
        updatedAt: '2026-08-28T00:00:00Z',
        unknownField: 'should be ignored',
      };
      await fs.writeFile(file, JSON.stringify(data));
      const result = readProjectSessions(tmpDir);
      expect(result).not.toHaveProperty('unknownField');
    });

    it('handles missing sessions array', async () => {
      const file = projectSessionsPath(tmpDir);
      const data = { version: 1, updatedAt: '2026-08-28T00:00:00Z' };
      await fs.writeFile(file, JSON.stringify(data));
      const result = readProjectSessions(tmpDir);
      expect(result.sessions).toHaveLength(0);
    });
  });

  describe('upsertProjectSession', () => {
    it('creates a new session entry when sessionId does not exist', () => {
      const input: UpsertInput = {
        sessionId: 'session-1',
        name: 'Test Session',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial discussion' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.created).toBe(true);
      expect(result.entry.sessionId).toBe('session-1');
      expect(result.entry.name).toBe('Test Session');
      expect(result.entry.activity).toHaveLength(1);
      expect(result.entry.createdAt).toMatch(/2026-08-28T00:00:00/);
      expect(result.entry.lastSeenAt).toMatch(/2026-08-28T00:00:00/);
    });

    it('appends activity to existing session and sets created: false', () => {
      const input1: UpsertInput = {
        sessionId: 'session-1',
        name: 'Test Session',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial discussion' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input1);

      const input2: UpsertInput = {
        sessionId: 'session-1',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'execution', description: 'Running tasks' },
        now: new Date('2026-08-28T01:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.created).toBe(false);
      expect(result.entry.activity).toHaveLength(2);
      expect(result.entry.activity[0]?.type).toBe('brainstorming');
      expect(result.entry.activity[1]?.type).toBe('execution');
      expect(result.entry.lastSeenAt).toMatch(/2026-08-28T01:00:00/);
    });

    it('updates name on subsequent save when provided', () => {
      const input1: UpsertInput = {
        sessionId: 'session-1',
        name: 'Original Name',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input1);

      const input2: UpsertInput = {
        sessionId: 'session-1',
        name: 'Updated Name',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'execution', description: 'Running' },
        now: new Date('2026-08-28T01:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry.name).toBe('Updated Name');
    });

    it('preserves name on subsequent save when name is not provided', () => {
      const input1: UpsertInput = {
        sessionId: 'session-1',
        name: 'Original Name',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input1);

      const input2: UpsertInput = {
        sessionId: 'session-1',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'execution', description: 'Running' },
        now: new Date('2026-08-28T01:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry.name).toBe('Original Name');
    });

    it('returns name_required when creating without a name', async () => {
      const input: UpsertInput = {
        sessionId: 'session-1',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('name_required');
      // Verify file was not created
      const exists = fsSyncMod.existsSync(projectSessionsPath(tmpDir));
      expect(exists).toBe(false);
    });

    it('does not create file when name_required rejection occurs', async () => {
      const beforePath = projectSessionsPath(tmpDir);
      const beforeExists = fsSyncMod.existsSync(beforePath);

      const input: UpsertInput = {
        sessionId: 'session-1',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input);

      const afterPath = projectSessionsPath(tmpDir);
      const afterExists = fsSyncMod.existsSync(afterPath);

      expect(beforeExists).toBe(false);
      expect(afterExists).toBe(false);
    });

    it('stores unrecognized activity type verbatim', () => {
      const input: UpsertInput = {
        sessionId: 'session-1',
        name: 'Test',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'custom-unknown-type', description: 'Custom activity' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry.activity[0]?.type).toBe('custom-unknown-type');
    });

    it('writes atomically without leaving .tmp file', () => {
      const input: UpsertInput = {
        sessionId: 'session-1',
        name: 'Test',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input);

      const files = fsSyncMod.readdirSync(tmpDir);
      const tmpFiles = files.filter((f) => f.includes('.tmp'));
      expect(tmpFiles).toHaveLength(0);
      expect(files).toContain(PROJECT_SESSIONS_FILE);
    });

    it('deduplicates by sessionId across multiple saves', () => {
      const input1: UpsertInput = {
        sessionId: 'session-1',
        name: 'Test',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Activity 1' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input1);

      const input2: UpsertInput = {
        sessionId: 'session-1',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'execution', description: 'Activity 2' },
        now: new Date('2026-08-28T01:00:00Z'),
      };
      upsertProjectSession(tmpDir, input2);

      const file = readProjectSessions(tmpDir);
      expect(file.sessions).toHaveLength(1);
      expect(file.sessions[0]?.activity).toHaveLength(2);
    });

    it('ignores empty string name on subsequent save', () => {
      const input1: UpsertInput = {
        sessionId: 'session-1',
        name: 'Original',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input1);

      const input2: UpsertInput = {
        sessionId: 'session-1',
        name: '', // Empty string should be treated like not provided
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'execution', description: 'Running' },
        now: new Date('2026-08-28T01:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry.name).toBe('Original');
    });

    it('rejects a whitespace-only name on create the same as an absent one', () => {
      const input: UpsertInput = {
        sessionId: 'session-1',
        name: '   ',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('name_required');
      expect(fsSyncMod.existsSync(projectSessionsPath(tmpDir))).toBe(false);
    });

    it('creates the project directory on a fresh install before writing the sessions file', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'project-dir');
      expect(fsSyncMod.existsSync(nestedDir)).toBe(false);

      const input: UpsertInput = {
        sessionId: 'session-1',
        name: 'Test',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      const result = upsertProjectSession(nestedDir, input);
      expect(result.ok).toBe(true);
      expect(fsSyncMod.existsSync(nestedDir)).toBe(true);
    });

    it('reclaims a stale lock left behind by a crashed writer instead of hanging', () => {
      const lockFile = `${projectSessionsPath(tmpDir)}.lock`;
      fsSyncMod.writeFileSync(lockFile, '', 'utf8');
      const old = new Date(Date.now() - 60_000);
      fsSyncMod.utimesSync(lockFile, old, old);

      const input: UpsertInput = {
        sessionId: 'session-1',
        name: 'Test',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input);
      expect(result.ok).toBe(true);
      expect(fsSyncMod.existsSync(lockFile)).toBe(false);
    });

    it('does not leave a lock file behind after a successful write', () => {
      const input: UpsertInput = {
        sessionId: 'session-1',
        name: 'Test',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Initial' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input);
      expect(fsSyncMod.existsSync(`${projectSessionsPath(tmpDir)}.lock`)).toBe(false);
    });

    it('handles multiple sessions independently', () => {
      const input1: UpsertInput = {
        sessionId: 'session-1',
        name: 'Session One',
        cwd: '/path/to/cwd1',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Session 1 activity' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input1);

      const input2: UpsertInput = {
        sessionId: 'session-2',
        name: 'Session Two',
        cwd: '/path/to/cwd2',
        harness: 'copilot',
        activity: { type: 'execution', description: 'Session 2 activity' },
        now: new Date('2026-08-28T01:00:00Z'),
      };
      upsertProjectSession(tmpDir, input2);

      const file = readProjectSessions(tmpDir);
      expect(file.sessions).toHaveLength(2);
      expect(file.sessions[0]?.sessionId).toBe('session-1');
      expect(file.sessions[1]?.sessionId).toBe('session-2');
    });

    it('preserves activity history when appending', () => {
      const input1: UpsertInput = {
        sessionId: 'session-1',
        name: 'Test',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'brainstorming', description: 'Activity 1' },
        now: new Date('2026-08-28T00:00:00Z'),
      };
      upsertProjectSession(tmpDir, input1);

      const input2: UpsertInput = {
        sessionId: 'session-1',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'requirements', description: 'Activity 2' },
        now: new Date('2026-08-28T01:00:00Z'),
      };
      upsertProjectSession(tmpDir, input2);

      const input3: UpsertInput = {
        sessionId: 'session-1',
        cwd: '/path/to/cwd',
        harness: 'claude',
        activity: { type: 'execution', description: 'Activity 3' },
        now: new Date('2026-08-28T02:00:00Z'),
      };
      const result = upsertProjectSession(tmpDir, input3);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry.activity).toHaveLength(3);
      expect(result.entry.activity[0]?.description).toBe('Activity 1');
      expect(result.entry.activity[1]?.description).toBe('Activity 2');
      expect(result.entry.activity[2]?.description).toBe('Activity 3');
      expect(result.entry.createdAt).toMatch(/2026-08-28T00:00:00/);
      expect(result.entry.lastSeenAt).toMatch(/2026-08-28T02:00:00/);
    });
  });
});
