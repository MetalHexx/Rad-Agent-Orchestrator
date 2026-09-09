import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import type { TerminalLaunchOptions, TerminalLaunchResult } from '@rad-orchestration/terminal-launch';
import type { CommandContext } from '../../../src/framework/context.js';

const { mockLaunchTerminal } = vi.hoisted(() => ({ mockLaunchTerminal: vi.fn() }));

// The dispatch matrix, spawn-attempt fallback, resume-mode, and quoting behavior
// are now @rad-orchestration/terminal-launch's own tests; duplicating them here
// would only double the maintenance. This file mocks the library so the CLI
// tests exercise only what belongs to the CLI: flag validation and the wiring
// from the command handler into the library.
vi.mock('@rad-orchestration/terminal-launch', () => ({
  launchTerminal: (opts: TerminalLaunchOptions) => mockLaunchTerminal(opts) as TerminalLaunchResult,
  LAUNCH_AGENTS: ['claude', 'copilot', 'vscode', 'terminal'],
  VALID_PERMISSION_MODES: ['default', 'acceptEdits', 'bypassPermissions', 'auto', 'dontAsk', 'plan'],
}));

import {
  validateLaunchFlags,
  worktreeLaunchCommand,
  VALID_PERMISSION_MODES,
} from '../../../src/commands/worktree/launch.js';
import { runCommand } from '../../../src/framework/command.js';

const addDir = path.join(os.homedir(), '.radorc', 'projects');

describe('validateLaunchFlags', () => {
  it('rejects --prompt with --agent vscode', () => {
    const r = validateLaunchFlags({ agent: 'vscode', prompt: '/x', permissionMode: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/--prompt.*vscode/);
  });
  it('rejects missing --prompt with --agent claude', () => {
    const r = validateLaunchFlags({ agent: 'claude', prompt: undefined, permissionMode: undefined });
    expect(r.ok).toBe(false);
  });
  it('rejects --permission-mode with --agent copilot', () => {
    const r = validateLaunchFlags({ agent: 'copilot', prompt: '/x', permissionMode: 'auto' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/--permission-mode.*claude/);
  });
  it('accepts default permission-mode auto for claude', () => {
    const r = validateLaunchFlags({ agent: 'claude', prompt: '/x', permissionMode: undefined });
    expect(r.ok).toBe(true);
  });
  it('rejects an invalid permission-mode', () => {
    const r = validateLaunchFlags({ agent: 'claude', prompt: '/x', permissionMode: 'wat' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/valid values/);
  });
  for (const mode of VALID_PERMISSION_MODES) {
    it(`accepts permission-mode ${mode} for claude`, () => {
      expect(validateLaunchFlags({ agent: 'claude', prompt: '/x', permissionMode: mode }).ok).toBe(true);
    });
  }
});

describe('worktreeLaunchCommand handler → launchTerminal wiring', () => {
  it('passes addDir and model explicitly, since the library no longer supplies them (anti-regression: dropping these silently removes --add-dir/--model from every worktree launch)', async () => {
    mockLaunchTerminal.mockReturnValue({ ok: true, platform: 'win32', agent: 'claude' } satisfies TerminalLaunchResult);
    await worktreeLaunchCommand.handler({
      args: { agent: 'claude', 'worktree-path': '/wt/x', prompt: '/rad-execute X', 'permission-mode': undefined },
      flags: {},
      ctx: {} as CommandContext,
    });
    expect(mockLaunchTerminal).toHaveBeenCalledWith({
      agent: 'claude', cwd: '/wt/x', prompt: '/rad-execute X', permissionMode: 'auto',
      addDir, model: 'sonnet',
    });
  });

  it('still passes addDir and model for non-claude agents even though the library ignores them there', async () => {
    mockLaunchTerminal.mockReturnValue({ ok: true, platform: 'win32', agent: 'terminal' } satisfies TerminalLaunchResult);
    await worktreeLaunchCommand.handler({
      args: { agent: 'terminal', 'worktree-path': '/wt/x' },
      flags: {},
      ctx: {} as CommandContext,
    });
    expect(mockLaunchTerminal).toHaveBeenCalledWith({
      agent: 'terminal', cwd: '/wt/x', prompt: undefined, permissionMode: undefined,
      addDir, model: 'sonnet',
    });
  });

  it('surfaces the launch result returned by the library', async () => {
    const failing = { ok: false, platform: 'win32', agent: 'claude', error: 'boom' } satisfies TerminalLaunchResult;
    mockLaunchTerminal.mockReturnValue(failing);
    const result = await worktreeLaunchCommand.handler({
      args: { agent: 'claude', 'worktree-path': '/wt/x', prompt: '/x' },
      flags: {},
      ctx: {} as CommandContext,
    });
    expect(result).toEqual(failing);
  });
});

describe('worktreeLaunch CLI path (runCommand argv → handler args)', () => {
  // Locks the framework contract: --worktree-path (required) and
  // --permission-mode (optional) must arrive at the handler under their
  // declared hyphenated keys. Before the framework fix --worktree-path
  // reproduced as "Missing required argument --worktree-path" regardless of
  // what the user supplied.
  it('passes --worktree-path, --agent, --prompt, --permission-mode through runCommand', async () => {
    type LaunchArgs = { agent?: string; 'worktree-path'?: string; prompt?: string; 'permission-mode'?: string };
    let received: LaunchArgs = {};
    const probeDef = {
      ...worktreeLaunchCommand,
      handler: async ({ args }: { args: LaunchArgs; ctx: unknown }) => {
        received = args;
        return { probed: true } as never;
      },
      mapResult: undefined,
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    await runCommand(probeDef, {
      argv: [
        '--agent', 'claude',
        '--worktree-path', '/wt/x',
        '--prompt', '/rad-execute X',
        '--permission-mode', 'auto',
      ],
      env: { RADORCH_NO_LOG: '1' },
      isTTY: false,
      stderr: process.stderr,
    });
    expect(received.agent).toBe('claude');
    expect(received['worktree-path']).toBe('/wt/x');
    expect(received.prompt).toBe('/rad-execute X');
    expect(received['permission-mode']).toBe('auto');
    const arg = (log.mock.calls[0]?.[0] ?? '') as string;
    const env = JSON.parse(arg);
    expect(env.ok).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
    log.mockRestore(); exit.mockRestore();
  });

  it('returns a well-formed user_error envelope when --worktree-path is omitted in non-interactive mode', async () => {
    // Probe handler keeps the test from invoking real spawn.
    const probeDef = {
      ...worktreeLaunchCommand,
      handler: async () => ({ probed: true } as never),
      mapResult: undefined,
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    await runCommand(probeDef, {
      argv: ['--non-interactive', '--agent', 'terminal'],
      env: { RADORCH_NO_LOG: '1' },
      isTTY: true,
      stderr: process.stderr,
    });
    const arg = (log.mock.calls[0]?.[0] ?? '') as string;
    const env = JSON.parse(arg);
    expect(env.ok).toBe(false);
    expect(env.error.type).toBe('user_error');
    expect(env.error.message).toMatch(/worktree-path/);
    expect(exit).toHaveBeenCalledWith(1);
    log.mockRestore(); exit.mockRestore();
  });
});
