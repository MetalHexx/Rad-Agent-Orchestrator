import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
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
// On a Windows test host, addDir contains backslashes; the darwin AppleScript
// builder now correctly escapes them (Finding 1), so the substring embedded
// in the darwin payload is doubled relative to the raw path on other platforms.
const expectedAddDir = (platform: NodeJS.Platform): string => (platform === 'darwin' ? addDir.replace(/\\/g, '\\\\') : addDir);

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

  function deliveredPayload(spawnFn: ReturnType<typeof vi.fn>, platform: NodeJS.Platform, callIndex = 0): string {
    const call = spawnFn.mock.calls[callIndex]!;
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

  /**
   * Decode the `do script "..."` string literal under AppleScript's own
   * escape rules: `\\` → one literal `\`, `\"` → one literal `"`, and an
   * unescaped `"` terminates the literal early (the bug Finding 1 fixes) —
   * anything after that point is not part of the decoded string.
   */
  function decodeAppleScriptDoScriptLiteral(script: string): string {
    const marker = 'do script "';
    const start = script.indexOf(marker) + marker.length;
    let out = '';
    for (let i = start; i < script.length; i++) {
      const ch = script[i];
      if (ch === '\\' && (script[i + 1] === '\\' || script[i + 1] === '"')) {
        out += script[i + 1];
        i++;
        continue;
      }
      if (ch === '"') break;
      out += ch;
    }
    return out;
  }

  it.each(['win32', 'darwin', 'linux'] as const)('launches claude on %s with internally-resolved --add-dir', (platform) => {
    const { spawn } = runCase('claude', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('claude');
    expect(payload).toContain(expectedAddDir(platform));
    expect(payload).toContain('--permission-mode');
    expect(payload).toContain('auto');
  });

  it.each(['win32', 'darwin', 'linux'] as const)('launches copilot on %s with internally-resolved --add-dir', (platform) => {
    const { spawn } = runCase('copilot', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('copilot');
    expect(payload).toContain(expectedAddDir(platform));
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

  it('on darwin a raw backslash-then-quote in the prompt round-trips intact through the emitted script', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const prompt = 'foo\\"bar';
    const result = worktreeLaunch({
      agent: 'claude', worktreePath: '/wt/x', prompt, permissionMode: 'auto', platform: 'darwin', spawn,
    });
    expect(result.ok).toBe(true);
    const script = deliveredPayload(spawn, 'darwin');
    const decoded = decodeAppleScriptDoScriptLiteral(script);
    expect(decoded).toContain(prompt);
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

  it.each(['win32', 'darwin', 'linux'] as const)('pins --model sonnet in the claude payload on %s', (platform) => {
    const { spawn } = runCase('claude', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('--model');
    expect(payload).toContain('sonnet');
  });

  it.each(['win32', 'darwin', 'linux'] as const)('omits --model and --permission-mode from the copilot payload on %s', (platform) => {
    const { spawn } = runCase('copilot', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).not.toContain('--model');
    expect(payload).not.toContain('--permission-mode');
  });

  it.each(['win32', 'darwin', 'linux'] as const)('omits --model and --permission-mode from the vscode payload on %s', (platform) => {
    const { spawn } = runCase('vscode', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).not.toContain('--model');
    expect(payload).not.toContain('--permission-mode');
  });

  it('defaults to --permission-mode auto when no permission mode is supplied at all', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = worktreeLaunch({
      agent: 'claude', worktreePath: '/wt/x', prompt: '/rad-execute X', platform: 'linux', spawn,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayload(spawn, 'linux');
    expect(payload).toContain('--permission-mode');
    expect(payload).toContain('auto');
  });
});

describe('worktreeLaunch spawn attempts (tab-or-window fallback)', () => {
  function throwingSpawn(...results: Array<'throw' | 'ok' | 'error-event'>) {
    const impl = (result: 'throw' | 'ok' | 'error-event') => {
      if (result === 'throw') return () => { throw new Error('ENOENT'); };
      if (result === 'error-event') return () => ({
        unref: () => undefined,
        on: (event: 'error', listener: (err: Error) => void) => { if (event === 'error') listener(new Error('ENOENT')); },
      });
      return () => ({ unref: () => undefined });
    };
    const spawn = vi.fn();
    for (const r of results) spawn.mockImplementationOnce(impl(r) as never);
    return spawn;
  }

  it('on win32 the first attempt targets -w 0 new-tab', () => {
    const spawn = throwingSpawn('ok');
    worktreeLaunch({ agent: 'terminal', worktreePath: '/wt/x', platform: 'win32', spawn });
    const [file, args] = spawn.mock.calls[0]!;
    expect(file).toBe('wt');
    expect((args as string[]).slice(0, 3)).toEqual(['-w', '0', 'new-tab']);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('on linux the first attempt uses --tab', () => {
    const spawn = throwingSpawn('ok');
    worktreeLaunch({ agent: 'terminal', worktreePath: '/wt/x', platform: 'linux', spawn });
    const [file, args] = spawn.mock.calls[0]!;
    expect(file).toBe('gnome-terminal');
    expect((args as string[])[0]).toBe('--tab');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('on darwin spawns once via osascript, unchanged', () => {
    const spawn = throwingSpawn('ok');
    const result = worktreeLaunch({ agent: 'terminal', worktreePath: '/wt/x', platform: 'darwin', spawn });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]![0]).toBe('osascript');
  });

  it('on win32 a tab attempt that throws falls back to the window form, and no third call fires', () => {
    const spawn = throwingSpawn('throw', 'ok');
    const result = worktreeLaunch({ agent: 'terminal', worktreePath: '/wt/x', platform: 'win32', spawn });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    const [file, args] = spawn.mock.calls[1]!;
    expect(file).toBe('wt');
    expect((args as string[]).slice(0, 2)).toEqual(['--startingDirectory', '/wt/x']);
    expect(args).not.toContain('new-tab');
  });

  it('on win32 a tab child that emits error falls back to the window form, and no third call fires', () => {
    const spawn = throwingSpawn('error-event', 'ok');
    const result = worktreeLaunch({ agent: 'terminal', worktreePath: '/wt/x', platform: 'win32', spawn });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    const [file, args] = spawn.mock.calls[1]!;
    expect(file).toBe('wt');
    expect((args as string[])[0]).toBe('--startingDirectory');
  });

  it('on linux a tab attempt that throws falls back to the window form, and no third call fires', () => {
    const spawn = throwingSpawn('throw', 'ok');
    const result = worktreeLaunch({ agent: 'terminal', worktreePath: '/wt/x', platform: 'linux', spawn });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    const [file, args] = spawn.mock.calls[1]!;
    expect(file).toBe('gnome-terminal');
    expect(args).not.toContain('--tab');
  });

  it('on linux a tab child that emits error falls back to the window form, and no third call fires', () => {
    const spawn = throwingSpawn('error-event', 'ok');
    const result = worktreeLaunch({ agent: 'terminal', worktreePath: '/wt/x', platform: 'linux', spawn });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    const [file, args] = spawn.mock.calls[1]!;
    expect(file).toBe('gnome-terminal');
    expect(args).not.toContain('--tab');
  });

  it('reports failure when both the tab and window attempts throw, without a third call', () => {
    const spawn = throwingSpawn('throw', 'throw');
    const result = worktreeLaunch({ agent: 'terminal', worktreePath: '/wt/x', platform: 'win32', spawn });
    expect(result.ok).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('the last attempt (darwin has only one, which is both first and last) attaches an error listener that swallows the event instead of leaving it uncaught', () => {
    let capturedChild: EventEmitter | undefined;
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { unref: () => undefined });
      capturedChild = child;
      return child as never;
    });
    const result = worktreeLaunch({ agent: 'terminal', worktreePath: '/wt/x', platform: 'darwin', spawn });
    expect(result.ok).toBe(true);
    // A real spawn's ENOENT surfaces as an async 'error' event on the child.
    // With no listener attached, EventEmitter throws synchronously on emit;
    // with the fix, the listener swallows it.
    expect(() => capturedChild!.emit('error', new Error('ENOENT'))).not.toThrow();
  });

  it('the win32 tab attempt payload still opens with the env-clearing prologue', () => {
    const spawn = throwingSpawn('ok');
    worktreeLaunch({
      agent: 'claude', worktreePath: '/wt/x', prompt: '/rad-execute X',
      permissionMode: 'auto', platform: 'win32', spawn,
    });
    const args = spawn.mock.calls[0]![1] as string[];
    expect(args.slice(0, 3)).toEqual(['-w', '0', 'new-tab']);
    const encoded = args[args.indexOf('-EncodedCommand') + 1]!;
    const payload = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(payload.startsWith('Remove-Item Env:CLAUDECODE')).toBe(true);
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
