import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  validateLaunchFlags,
  worktreeLaunch,
  worktreeLaunchCommand,
  repairMsysPrompt,
  quoteSinglePwsh,
  sanitizeLaunchEnv,
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

describe('repairMsysPrompt', () => {
  it('restores the leading slash when MSYS mangled the path', () => {
    const m = 'C:/Program Files/Git/rad-execute X';
    expect(repairMsysPrompt(m)).toBe('/rad-execute X');
  });
  it('leaves non-mangled prompts alone', () => {
    expect(repairMsysPrompt('/rad-execute X')).toBe('/rad-execute X');
    expect(repairMsysPrompt('not a slash command')).toBe('not a slash command');
  });
});

describe('worktreeLaunch dispatch matrix', () => {
  function runCase(agent: 'claude' | 'copilot' | 'vscode' | 'terminal', platform: NodeJS.Platform) {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = worktreeLaunch({
      agent, worktreePath: '/wt/x',
      prompt: agent === 'claude' || agent === 'copilot' ? '/rad-execute X' : undefined,
      permissionMode: agent === 'claude' ? 'auto' : undefined,
      platform, spawn,
    });
    expect(result.ok).toBe(true);
    return { spawn, result };
  }

  function deliveredPayload(spawnFn: ReturnType<typeof vi.fn>, platform: NodeJS.Platform): string {
    const call = spawnFn.mock.calls[0]!;
    const args = call[1] as string[];
    if (platform === 'win32') {
      const idx = args.indexOf('-EncodedCommand');
      if (idx === -1) return '';
      const encoded = args[idx + 1] ?? '';
      return Buffer.from(encoded, 'base64').toString('utf16le');
    }
    if (platform === 'darwin') {
      const idx = args.indexOf('-e');
      return args[idx + 1] ?? '';
    }
    // linux: gnome-terminal -- bash -c "<shell>"
    const dashDash = args.indexOf('--');
    const cIdx = args.indexOf('-c', dashDash);
    return args[cIdx + 1] ?? '';
  }

  it.each(['win32', 'darwin', 'linux'] as const)('launches claude on %s with internally-resolved --add-dir', (platform) => {
    const { spawn } = runCase('claude', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('claude');
    expect(payload).toContain(addDir);
    expect(payload).toContain('--permission-mode');
    expect(payload).toContain('auto');
  });

  it.each(['win32', 'darwin', 'linux'] as const)('launches copilot on %s with internally-resolved --add-dir', (platform) => {
    const { spawn } = runCase('copilot', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('copilot');
    expect(payload).toContain(addDir);
    expect(payload).toContain('--allow-tool=shell');
    expect(payload).toContain('-i');
    expect(payload).toContain('/rad-execute X');
    expect(payload).not.toContain('--agent');
    expect(payload).not.toContain('orchestrator');
  });

  it.each(['win32', 'darwin', 'linux'] as const)('launches vscode on %s without --prompt or --add-dir', (platform) => {
    const { spawn } = runCase('vscode', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('code');
    expect(payload).not.toContain('--prompt');
    expect(payload).not.toContain(addDir);
  });

  it.each(['win32', 'darwin', 'linux'] as const)('launches terminal on %s with cd to worktree', (platform) => {
    const { spawn } = runCase('terminal', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload.toLowerCase()).toContain('wt/x'.toLowerCase());
  });

  it('on win32 claude uses wt + EncodedCommand', () => {
    const { spawn } = runCase('claude', 'win32');
    const target = spawn.mock.calls[0]![0];
    const args = spawn.mock.calls[0]![1] as string[];
    expect(target).toBe('wt');
    expect(args).toContain('-EncodedCommand');
  });

  it('on darwin uses osascript', () => {
    const { spawn } = runCase('claude', 'darwin');
    expect(spawn.mock.calls[0]![0]).toBe('osascript');
  });

  it('on linux uses gnome-terminal', () => {
    const { spawn } = runCase('claude', 'linux');
    expect(spawn.mock.calls[0]![0]).toBe('gnome-terminal');
  });

  it('on win32 escapes single-quotes in worktreePath using PowerShell doubling, not POSIX', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = worktreeLaunch({
      agent: 'terminal',
      worktreePath: "/wt/o'reilly",
      platform: 'win32',
      spawn,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayload(spawn, 'win32');
    // PowerShell literal-string rule: ' inside '...' is escaped as ''
    expect(payload).toContain("Set-Location '/wt/o''reilly'");
    // POSIX form must NOT appear inside the PowerShell payload.
    expect(payload).not.toContain("'\\''");
  });

  it('on win32 escapes single-quotes in prompt arg using PowerShell doubling, not POSIX', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = worktreeLaunch({
      agent: 'claude',
      worktreePath: '/wt/x',
      prompt: "/x's command",
      permissionMode: 'auto',
      platform: 'win32',
      spawn,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayload(spawn, 'win32');
    // The prompt is the 4th positional arg in claude invocation; it must be
    // PowerShell-quoted with '' for the embedded single quote.
    expect(payload).toContain("'/x''s command'");
    expect(payload).not.toContain("'\\''");
  });
});

describe('sanitizeLaunchEnv', () => {
  it('drops CLAUDECODE and every CLAUDE_CODE_* key, preserves the rest, never mutates input', () => {
    const input = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SSE_PORT: '4567',
      CLAUDE_EFFORT: 'high',     // NOT a CLAUDE_CODE_ var — must survive
      PATH: '/usr/bin',
      HOME: '/home/x',
    };
    const out = sanitizeLaunchEnv(input);
    expect(out.CLAUDECODE).toBeUndefined();
    expect(out.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(out.CLAUDE_CODE_SSE_PORT).toBeUndefined();
    expect(out.CLAUDE_EFFORT).toBe('high');
    expect(out.PATH).toBe('/usr/bin');
    expect(out.HOME).toBe('/home/x');
    // input untouched (no process.env mutation in production either)
    expect(input.CLAUDECODE).toBe('1');
    expect(input.CLAUDE_CODE_ENTRYPOINT).toBe('cli');
  });
});

describe('worktreeLaunch sanitizes the spawn env (top-level session)', () => {
  function spawnEnvFor(platform: NodeJS.Platform): NodeJS.ProcessEnv {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const prev = {
      CLAUDECODE: process.env.CLAUDECODE,
      CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT,
      CLAUDE_EFFORT: process.env.CLAUDE_EFFORT,
      RAD_TEST_SENTINEL: process.env.RAD_TEST_SENTINEL,
    };
    try {
      process.env.CLAUDECODE = '1';
      process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
      process.env.CLAUDE_EFFORT = 'high';
      process.env.RAD_TEST_SENTINEL = 'keep';
      worktreeLaunch({
        agent: 'claude', worktreePath: '/wt/x', prompt: '/rad-execute X',
        permissionMode: 'auto', platform, spawn,
      });
      return spawn.mock.calls[0]![2].env as NodeJS.ProcessEnv;
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  }

  it.each(['win32', 'darwin', 'linux'] as const)('strips CLAUDECODE/CLAUDE_CODE_* but keeps CLAUDE_EFFORT on %s', (platform) => {
    const env = spawnEnvFor(platform);
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_EFFORT).toBe('high');
    expect(env.RAD_TEST_SENTINEL).toBe('keep');
  });

  it('on win32 also clears the markers inside the encoded PowerShell payload (wt broker belt-and-suspenders)', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    worktreeLaunch({
      agent: 'claude', worktreePath: '/wt/x', prompt: '/rad-execute X',
      permissionMode: 'auto', platform: 'win32', spawn,
    });
    const args = spawn.mock.calls[0]![1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1]!;
    const payload = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(payload).toContain('Remove-Item Env:CLAUDECODE');
    expect(payload).toContain('Env:CLAUDE_CODE_*');
  });
});

describe('quoteSinglePwsh', () => {
  it('wraps an empty string in single quotes', () => {
    expect(quoteSinglePwsh('')).toBe("''");
  });
  it('wraps a plain string without modification', () => {
    expect(quoteSinglePwsh('hello world')).toBe("'hello world'");
  });
  it('doubles a single quote per PowerShell literal-string rules', () => {
    expect(quoteSinglePwsh("'")).toBe("''''");
  });
  it('doubles every single quote in a mixed string', () => {
    expect(quoteSinglePwsh("o'reilly's book")).toBe("'o''reilly''s book'");
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
