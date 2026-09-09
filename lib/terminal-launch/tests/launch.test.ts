import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  launchTerminal,
  repairMsysPrompt,
  quoteSinglePwsh,
  sanitizeLaunchEnv,
} from '../src/index.js';

const ADD_DIR = '/home/tester/.radorc/projects';

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

describe('launchTerminal dispatch matrix', () => {
  function runCase(agent: 'claude' | 'copilot' | 'vscode' | 'terminal', platform: NodeJS.Platform) {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = launchTerminal({
      agent, cwd: '/wt/x',
      prompt: agent === 'claude' || agent === 'copilot' ? '/rad-execute X' : undefined,
      permissionMode: agent === 'claude' ? 'auto' : undefined,
      addDir: agent === 'claude' || agent === 'copilot' ? ADD_DIR : undefined,
      model: agent === 'claude' ? 'sonnet' : undefined,
      platform, spawn, cwdExists: () => true,
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
   * unescaped `"` terminates the literal early — anything after that point
   * is not part of the decoded string.
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

  it.each(['win32', 'darwin', 'linux'] as const)('launches claude on %s with the supplied --add-dir', (platform) => {
    const { spawn } = runCase('claude', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('claude');
    expect(payload).toContain(ADD_DIR);
    expect(payload).toContain('--permission-mode');
    expect(payload).toContain('auto');
  });

  it.each(['win32', 'darwin', 'linux'] as const)('launches copilot on %s with the supplied --add-dir', (platform) => {
    const { spawn } = runCase('copilot', platform);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('copilot');
    expect(payload).toContain(ADD_DIR);
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
    expect(payload).not.toContain(ADD_DIR);
  });

  it.each(['win32', 'darwin', 'linux'] as const)('launches terminal on %s with cd to cwd', (platform) => {
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
    const result = launchTerminal({
      agent: 'claude', cwd: '/wt/x', prompt, permissionMode: 'auto', platform: 'darwin', spawn, cwdExists: () => true,
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

  it('on win32 escapes single-quotes in cwd using PowerShell doubling, not POSIX', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = launchTerminal({
      agent: 'terminal',
      cwd: "/wt/o'reilly",
      platform: 'win32',
      spawn,
      cwdExists: () => true,
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
    const result = launchTerminal({
      agent: 'claude',
      cwd: '/wt/x',
      prompt: "/x's command",
      permissionMode: 'auto',
      platform: 'win32',
      spawn,
      cwdExists: () => true,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayload(spawn, 'win32');
    // The prompt is a positional arg in the claude invocation; it must be
    // PowerShell-quoted with '' for the embedded single quote.
    expect(payload).toContain("'/x''s command'");
    expect(payload).not.toContain("'\\''");
  });

  it.each(['win32', 'darwin', 'linux'] as const)('omits --model and --permission-mode from the copilot payload on %s, even when model is supplied', (platform) => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = launchTerminal({
      agent: 'copilot', cwd: '/wt/x', prompt: '/rad-execute X', addDir: ADD_DIR, model: 'sonnet',
      platform, spawn, cwdExists: () => true,
    });
    expect(result.ok).toBe(true);
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
    const result = launchTerminal({
      agent: 'claude', cwd: '/wt/x', prompt: '/rad-execute X', platform: 'linux', spawn, cwdExists: () => true,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayload(spawn, 'linux');
    expect(payload).toContain('--permission-mode');
    expect(payload).toContain('auto');
  });
});

describe('addDir and model are caller-supplied inputs', () => {
  function deliveredPayloadLinux(spawnFn: ReturnType<typeof vi.fn>): string {
    const args = spawnFn.mock.calls[0]![1] as string[];
    const dashDash = args.indexOf('--');
    const cIdx = args.indexOf('-c', dashDash);
    return args[cIdx + 1] ?? '';
  }

  it('claude: addDir omitted emits no --add-dir; model omitted emits no --model', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = launchTerminal({
      agent: 'claude', cwd: '/wt/x', prompt: '/rad-execute X', permissionMode: 'auto',
      platform: 'linux', spawn, cwdExists: () => true,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayloadLinux(spawn);
    expect(payload).not.toContain('--add-dir');
    expect(payload).not.toContain('--model');
  });

  it('copilot: addDir omitted emits no --add-dir', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = launchTerminal({
      agent: 'copilot', cwd: '/wt/x', prompt: '/rad-execute X',
      platform: 'linux', spawn, cwdExists: () => true,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayloadLinux(spawn);
    expect(payload).not.toContain('--add-dir');
  });

  it('claude: addDir and model present reproduce the CLI current argument list byte for byte', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = launchTerminal({
      agent: 'claude', cwd: '/wt/x', prompt: '/rad-execute X', permissionMode: 'auto',
      addDir: ADD_DIR, model: 'sonnet', platform: 'win32', spawn, cwdExists: () => true,
    });
    expect(result.ok).toBe(true);
    const args = spawn.mock.calls[0]![1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1]!;
    const payload = Buffer.from(encoded, 'base64').toString('utf16le');
    const expectedAgentPart = ['claude', '--permission-mode', 'auto', '--model', 'sonnet', '/rad-execute X', '--add-dir', ADD_DIR]
      .map((tok, i) => (i === 0 ? tok : quoteSinglePwsh(tok)))
      .join(' ');
    expect(payload).toContain(expectedAgentPart);
    expect(result.permissionMode).toBe('auto');
  });

  it('copilot: addDir present (model still ignored) reproduces the CLI current argument list byte for byte', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = launchTerminal({
      agent: 'copilot', cwd: '/wt/x', prompt: '/rad-execute X', addDir: ADD_DIR, model: 'sonnet',
      platform: 'linux', spawn, cwdExists: () => true,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayloadLinux(spawn);
    expect(payload).toContain('copilot');
    expect(payload).toContain('--add-dir');
    expect(payload).toContain(ADD_DIR);
    expect(payload).toContain('--allow-tool=shell');
    expect(payload).toContain('-i');
    expect(payload).toContain('/rad-execute X');
    expect(payload).not.toContain('--model');
  });
});

describe('launchTerminal directory validation', () => {
  it('returns ok:false naming the directory and never calls spawn when cwd does not exist', () => {
    const spawn = vi.fn();
    const result = launchTerminal({
      agent: 'terminal', cwd: '/does/not/exist', platform: 'linux', spawn,
      cwdExists: () => false,
    });
    expect(result).toEqual({
      ok: false, platform: 'linux', agent: 'terminal',
      error: 'Launch directory no longer exists: /does/not/exist',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('defaults cwdExists to fs.existsSync when not supplied', () => {
    const spawn = vi.fn();
    const result = launchTerminal({
      agent: 'terminal', cwd: '/definitely/not/a/real/path/rad-terminal-launch-fixture', platform: 'linux', spawn,
    });
    expect(result.ok).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('launchTerminal spawn attempts (tab-or-window fallback)', () => {
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
    launchTerminal({ agent: 'terminal', cwd: '/wt/x', platform: 'win32', spawn, cwdExists: () => true });
    const [file, args] = spawn.mock.calls[0]!;
    expect(file).toBe('wt');
    expect((args as string[]).slice(0, 3)).toEqual(['-w', '0', 'new-tab']);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('on linux the first attempt uses --tab', () => {
    const spawn = throwingSpawn('ok');
    launchTerminal({ agent: 'terminal', cwd: '/wt/x', platform: 'linux', spawn, cwdExists: () => true });
    const [file, args] = spawn.mock.calls[0]!;
    expect(file).toBe('gnome-terminal');
    expect((args as string[])[0]).toBe('--tab');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('on darwin spawns once via osascript, unchanged', () => {
    const spawn = throwingSpawn('ok');
    const result = launchTerminal({ agent: 'terminal', cwd: '/wt/x', platform: 'darwin', spawn, cwdExists: () => true });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]![0]).toBe('osascript');
  });

  it('on win32 a tab attempt that throws falls back to the window form, and no third call fires', () => {
    const spawn = throwingSpawn('throw', 'ok');
    const result = launchTerminal({ agent: 'terminal', cwd: '/wt/x', platform: 'win32', spawn, cwdExists: () => true });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    const [file, args] = spawn.mock.calls[1]!;
    expect(file).toBe('wt');
    expect((args as string[]).slice(0, 2)).toEqual(['--startingDirectory', '/wt/x']);
    expect(args).not.toContain('new-tab');
  });

  it('on win32 a tab child that emits error falls back to the window form, and no third call fires', () => {
    const spawn = throwingSpawn('error-event', 'ok');
    const result = launchTerminal({ agent: 'terminal', cwd: '/wt/x', platform: 'win32', spawn, cwdExists: () => true });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    const [file, args] = spawn.mock.calls[1]!;
    expect(file).toBe('wt');
    expect((args as string[])[0]).toBe('--startingDirectory');
  });

  it('on linux a tab attempt that throws falls back to the window form, and no third call fires', () => {
    const spawn = throwingSpawn('throw', 'ok');
    const result = launchTerminal({ agent: 'terminal', cwd: '/wt/x', platform: 'linux', spawn, cwdExists: () => true });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    const [file, args] = spawn.mock.calls[1]!;
    expect(file).toBe('gnome-terminal');
    expect(args).not.toContain('--tab');
  });

  it('on linux a tab child that emits error falls back to the window form, and no third call fires', () => {
    const spawn = throwingSpawn('error-event', 'ok');
    const result = launchTerminal({ agent: 'terminal', cwd: '/wt/x', platform: 'linux', spawn, cwdExists: () => true });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    const [file, args] = spawn.mock.calls[1]!;
    expect(file).toBe('gnome-terminal');
    expect(args).not.toContain('--tab');
  });

  it('reports failure when both the tab and window attempts throw, without a third call', () => {
    const spawn = throwingSpawn('throw', 'throw');
    const result = launchTerminal({ agent: 'terminal', cwd: '/wt/x', platform: 'win32', spawn, cwdExists: () => true });
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
    const result = launchTerminal({ agent: 'terminal', cwd: '/wt/x', platform: 'darwin', spawn, cwdExists: () => true });
    expect(result.ok).toBe(true);
    // A real spawn's ENOENT surfaces as an async 'error' event on the child.
    // With no listener attached, EventEmitter throws synchronously on emit;
    // with the fix, the listener swallows it.
    expect(() => capturedChild!.emit('error', new Error('ENOENT'))).not.toThrow();
  });

  it('the win32 tab attempt payload still opens with the env-clearing prologue for claude', () => {
    const spawn = throwingSpawn('ok');
    launchTerminal({
      agent: 'claude', cwd: '/wt/x', prompt: '/rad-execute X',
      permissionMode: 'auto', platform: 'win32', spawn, cwdExists: () => true,
    });
    const args = spawn.mock.calls[0]![1] as string[];
    expect(args.slice(0, 3)).toEqual(['-w', '0', 'new-tab']);
    const encoded = args[args.indexOf('-EncodedCommand') + 1]!;
    const payload = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(payload.startsWith('Remove-Item Env:CLAUDECODE')).toBe(true);
  });
});

describe('sanitizeLaunchEnv', () => {
  it("claude drops CLAUDECODE and every CLAUDE_CODE_* key, preserves the rest, never mutates input", () => {
    const input = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SSE_PORT: '4567',
      CLAUDE_EFFORT: 'high',     // NOT a CLAUDE_CODE_ var — must survive
      PATH: '/usr/bin',
      HOME: '/home/x',
    };
    const out = sanitizeLaunchEnv('claude', input);
    expect(out.CLAUDECODE).toBeUndefined();
    expect(out.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(out.CLAUDE_CODE_SSE_PORT).toBeUndefined();
    expect(out.CLAUDE_EFFORT).toBe('high');
    expect(out.PATH).toBe('/usr/bin');
    expect(out.HOME).toBe('/home/x');
    // input untouched (no mutation in production either)
    expect(input.CLAUDECODE).toBe('1');
    expect(input.CLAUDE_CODE_ENTRYPOINT).toBe('cli');
  });

  it('copilot strips nothing, never mutates input', () => {
    const input = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      COPILOT_SUPERVISED: '1',
      PATH: '/usr/bin',
    };
    const out = sanitizeLaunchEnv('copilot', input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(input.CLAUDECODE).toBe('1');
  });
});

describe('launchTerminal sanitizes the spawn env (top-level session)', () => {
  const baseEnv = {
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_EFFORT: 'high',
    RAD_TEST_SENTINEL: 'keep',
  };

  it.each(['win32', 'darwin', 'linux'] as const)('strips CLAUDECODE/CLAUDE_CODE_* but keeps CLAUDE_EFFORT on %s for claude', (platform) => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    launchTerminal({
      agent: 'claude', cwd: '/wt/x', prompt: '/rad-execute X',
      permissionMode: 'auto', platform, spawn, cwdExists: () => true, env: baseEnv,
    });
    const env = spawn.mock.calls[0]![2].env as NodeJS.ProcessEnv;
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_EFFORT).toBe('high');
    expect(env.RAD_TEST_SENTINEL).toBe('keep');
  });

  it('leaves CLAUDECODE untouched for copilot (empty marker set)', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    launchTerminal({
      agent: 'copilot', cwd: '/wt/x', prompt: '/rad-execute X',
      platform: 'linux', spawn, cwdExists: () => true, env: baseEnv,
    });
    const env = spawn.mock.calls[0]![2].env as NodeJS.ProcessEnv;
    expect(env.CLAUDECODE).toBe('1');
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe('cli');
  });

  it('on win32 also clears the markers inside the encoded PowerShell payload for claude (wt broker belt-and-suspenders)', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    launchTerminal({
      agent: 'claude', cwd: '/wt/x', prompt: '/rad-execute X',
      permissionMode: 'auto', platform: 'win32', spawn, cwdExists: () => true, env: baseEnv,
    });
    const args = spawn.mock.calls[0]![1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1]!;
    const payload = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(payload).toContain('Remove-Item Env:CLAUDECODE');
    expect(payload).toContain('Env:CLAUDE_CODE_*');
  });

  it('on win32 does not emit the env-clearing prologue for non-claude agents', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    launchTerminal({
      agent: 'terminal', cwd: '/wt/x', platform: 'win32', spawn, cwdExists: () => true, env: baseEnv,
    });
    const args = spawn.mock.calls[0]![1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1]!;
    const payload = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(payload).not.toContain('Remove-Item Env:CLAUDECODE');
  });
});

describe('launchTerminal resume mode', () => {
  function deliveredPayload(spawnFn: ReturnType<typeof vi.fn>, platform: NodeJS.Platform): string {
    const call = spawnFn.mock.calls[0]!;
    const args = call[1] as string[];
    if (platform === 'win32') {
      const idx = args.indexOf('-EncodedCommand');
      const encoded = args[idx + 1] ?? '';
      return Buffer.from(encoded, 'base64').toString('utf16le');
    }
    if (platform === 'darwin') {
      const idx = args.indexOf('-e');
      return args[idx + 1] ?? '';
    }
    const dashDash = args.indexOf('--');
    const cIdx = args.indexOf('-c', dashDash);
    return args[cIdx + 1] ?? '';
  }

  it.each(['win32', 'darwin', 'linux'] as const)('claude resume produces `claude --resume <id>` with no prompt/model/add-dir on %s', (platform) => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = launchTerminal({
      agent: 'claude', cwd: '/wt/x', resumeSessionId: 'sess-1', platform, spawn, cwdExists: () => true,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('claude');
    expect(payload).toContain('--resume');
    expect(payload).toContain('sess-1');
    expect(payload).not.toContain('--model');
    expect(payload).not.toContain('--permission-mode');
    expect(payload).not.toContain('--add-dir');
  });

  it.each(['win32', 'darwin', 'linux'] as const)('copilot resume produces `copilot --resume=<id>` with no add-dir on %s', (platform) => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    const result = launchTerminal({
      agent: 'copilot', cwd: '/wt/y', resumeSessionId: 'sess-2', platform, spawn, cwdExists: () => true,
    });
    expect(result.ok).toBe(true);
    const payload = deliveredPayload(spawn, platform);
    expect(payload).toContain('copilot');
    expect(payload).toContain('--resume=sess-2');
    expect(payload).not.toContain('--add-dir');
  });

  it('resume mode still opens the terminal at the recorded cwd and sanitizes env', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    launchTerminal({ agent: 'claude', cwd: '/wt/x', resumeSessionId: 'sess-1', platform: 'win32', spawn, cwdExists: () => true });
    const payload = deliveredPayload(spawn, 'win32');
    expect(payload).toContain("Set-Location '/wt/x'");
    expect(payload.startsWith('Remove-Item Env:CLAUDECODE')).toBe(true);
  });

  it('resumeSessionId wins over prompt when both are supplied', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }) as never);
    launchTerminal({
      agent: 'claude', cwd: '/wt/x', prompt: '/should-be-ignored',
      resumeSessionId: 'sess-1', platform: 'linux', spawn, cwdExists: () => true,
    });
    const payload = deliveredPayload(spawn, 'linux');
    expect(payload).toContain('--resume');
    expect(payload).toContain('sess-1');
    expect(payload).not.toContain('should-be-ignored');
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
