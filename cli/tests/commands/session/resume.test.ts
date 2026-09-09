import { describe, it, expect, vi } from 'vitest';
import {
  sessionResume,
  type SessionResumeOptions,
} from '../../../src/commands/session/resume.js';
import type { ProjectSessionsFile } from '../../../src/lib/project-sessions.js';
import type { TerminalLaunchOptions, TerminalLaunchResult } from '@rad-orchestration/terminal-launch';

function baseOpts(overrides: Partial<SessionResumeOptions> = {}): SessionResumeOptions {
  const file: ProjectSessionsFile = {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    sessions: [
      {
        sessionId: 'sess-1',
        name: 'My session',
        cwd: '/wt/x',
        harness: 'claude',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        activity: [],
      },
    ],
  };
  return {
    projectsRoot: '/projects',
    telemetryRoot: '/telemetry',
    sessionId: 'sess-1',
    lookupSessionProject: vi.fn(() => 'AIOPS-1'),
    readProjectSessions: vi.fn(() => file),
    launch: vi.fn((): TerminalLaunchResult => ({ ok: true, platform: 'win32', agent: 'claude' })),
    ...overrides,
  };
}

describe('sessionResume', () => {
  it('resolves project/cwd/harness from the index and record, then reaches launchTerminal with exactly { agent, cwd, resumeSessionId }', () => {
    const opts = baseOpts();
    const result = sessionResume(opts);
    expect(result).toEqual({
      sessionId: 'sess-1', project: 'AIOPS-1', cwd: '/wt/x', harness: 'claude', launched: true,
    });
    expect(opts.launch).toHaveBeenCalledWith({
      agent: 'claude', cwd: '/wt/x', resumeSessionId: 'sess-1',
    } satisfies TerminalLaunchOptions);
  });

  it('launches copilot with the resume shape when the recorded harness is copilot', () => {
    const file: ProjectSessionsFile = {
      version: 1, updatedAt: '', sessions: [{
        sessionId: 'sess-2', name: 'n', cwd: '/wt/y', harness: 'copilot',
        createdAt: '', lastSeenAt: '', activity: [],
      }],
    };
    const opts = baseOpts({
      sessionId: 'sess-2',
      readProjectSessions: vi.fn(() => file),
    });
    const result = sessionResume({ ...opts, sessionId: 'sess-2' });
    expect(result.launched).toBe(true);
    expect(result.harness).toBe('copilot');
    expect(opts.launch).toHaveBeenCalledWith({
      agent: 'copilot', cwd: '/wt/y', resumeSessionId: 'sess-2',
    } satisfies TerminalLaunchOptions);
  });

  it('--harness overrides the recorded harness', () => {
    const opts = baseOpts({ harness: 'copilot' });
    const result = sessionResume(opts);
    expect(result.harness).toBe('copilot');
    expect(opts.launch).toHaveBeenCalledWith({
      agent: 'copilot', cwd: '/wt/x', resumeSessionId: 'sess-1',
    } satisfies TerminalLaunchOptions);
  });

  it('throws a user error when the session id is not in the telemetry index', () => {
    const opts = baseOpts({ lookupSessionProject: vi.fn(() => null) });
    expect(() => sessionResume(opts)).toThrow(/not attributed to any project/);
    expect(opts.launch).not.toHaveBeenCalled();
  });

  it('throws a user error when the index points at a project with no matching session record', () => {
    const emptyFile: ProjectSessionsFile = { version: 1, updatedAt: '', sessions: [] };
    const opts = baseOpts({ readProjectSessions: vi.fn(() => emptyFile) });
    expect(() => sessionResume(opts)).toThrow(/no matching session record/);
    expect(opts.launch).not.toHaveBeenCalled();
  });

  // The launch-directory check now lives in @rad-orchestration/terminal-launch;
  // sessionResume no longer probes the filesystem itself, so a missing directory
  // arrives the same way as any other launch failure — through `error` on the
  // library's result, surfaced verbatim as `reason`.
  it('returns launched: false with the library\'s "no longer exists" reason verbatim, with no separate CLI-side directory check', () => {
    const opts = baseOpts({
      launch: vi.fn((): TerminalLaunchResult => ({
        ok: false, platform: 'win32', agent: 'claude', error: 'Launch directory no longer exists: /wt/x',
      })),
    });
    const result = sessionResume(opts);
    expect(result.launched).toBe(false);
    expect(result.reason).toBe('Launch directory no longer exists: /wt/x');
  });

  it('surfaces a launch failure as launched: false with the launcher error as the reason', () => {
    const opts = baseOpts({ launch: vi.fn(() => ({ ok: false, platform: 'win32', agent: 'claude', error: 'boom' }) as TerminalLaunchResult) });
    const result = sessionResume(opts);
    expect(result.launched).toBe(false);
    expect(result.reason).toBe('boom');
  });

  it('defaults the reason to "Launch failed" when the library reports failure without an error message', () => {
    const opts = baseOpts({ launch: vi.fn(() => ({ ok: false, platform: 'win32', agent: 'claude' }) as TerminalLaunchResult) });
    const result = sessionResume(opts);
    expect(result.launched).toBe(false);
    expect(result.reason).toBe('Launch failed');
  });
});
