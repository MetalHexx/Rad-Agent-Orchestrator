import fs from 'node:fs';
import { spawn as defaultSpawn } from 'node:child_process';
import { quoteSingle, quoteSinglePwsh } from './quote.js';
import { sanitizeLaunchEnv } from './env.js';

export type LaunchAgent = 'claude' | 'copilot' | 'vscode' | 'terminal';
export const LAUNCH_AGENTS: readonly LaunchAgent[] = ['claude', 'copilot', 'vscode', 'terminal'];
export const VALID_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'auto', 'dontAsk', 'plan'] as const;
export type PermissionMode = typeof VALID_PERMISSION_MODES[number];

export type SpawnFn = (
  file: string,
  args: readonly string[],
  opts: { detached: boolean; stdio: 'ignore'; env?: NodeJS.ProcessEnv },
) => { unref: () => void; on?: (e: 'error', l: (err: Error) => void) => unknown };

export interface TerminalLaunchOptions {
  agent: LaunchAgent;
  /** The directory the new terminal opens in. Validated before any spawn. */
  cwd: string;
  /** Fresh-session prompt. Ignored when resumeSessionId is set. */
  prompt?: string;
  permissionMode?: PermissionMode;          // claude only
  /** When set, resume this session instead of starting fresh with a prompt. */
  resumeSessionId?: string;
  /** Emitted as `--add-dir <addDir>` when set; the flag is omitted entirely when absent. */
  addDir?: string;
  /** Emitted as `--model <model>` when set; the flag is omitted entirely when absent. */
  model?: string;
  platform?: NodeJS.Platform;               // defaults to the host platform
  spawn?: SpawnFn;                          // defaults to node:child_process spawn
  cwdExists?: (p: string) => boolean;       // defaults to fs.existsSync
  env?: NodeJS.ProcessEnv;                  // defaults to process.env
}

export interface TerminalLaunchResult {
  ok: boolean;
  platform: NodeJS.Platform;
  agent: LaunchAgent;
  permissionMode?: PermissionMode;
  error?: string;
}

export function repairMsysPrompt(prompt: string | undefined): string | undefined {
  if (typeof prompt !== 'string' || prompt.length === 0) return prompt;
  if (prompt.startsWith('/')) return prompt;
  if (!/^[A-Za-z]:[\\/]/.test(prompt)) return prompt;
  for (let i = prompt.length - 1; i >= 0; i--) {
    const ch = prompt[i];
    if (ch !== '/' && ch !== '\\') continue;
    const tailStart = i + 1;
    let tailEnd = tailStart;
    while (tailEnd < prompt.length && !/\s/.test(prompt[tailEnd]!)) tailEnd++;
    const command = prompt.slice(tailStart, tailEnd);
    if (!/^[A-Za-z][\w-]*$/.test(command)) continue;
    return `/${command}${prompt.slice(tailEnd)}`;
  }
  return prompt;
}

// On Windows, `wt` may route the new tab through an existing Windows Terminal broker
// process, so the spawned shell can inherit the *broker's* env rather than the one we
// pass to spawn(). Belt-and-suspenders: also clear the markers inside the encoded
// PowerShell payload before launching the agent. Claude-specific — no macOS or Linux
// counterpart, and none is added for other agents.
const CLEAR_ENV_PWSH =
  'Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue; '
  + 'Get-ChildItem Env:CLAUDE_CODE_* | Remove-Item -ErrorAction SilentlyContinue;';

/** Build the inner command arg list for claude. Returns an array of literal args. */
function buildClaudeArgs(prompt: string, permissionMode: PermissionMode, addDir: string | undefined, model: string | undefined): string[] {
  const args = ['claude', '--permission-mode', permissionMode];
  if (model) args.push('--model', model);
  args.push(prompt);
  if (addDir) args.push('--add-dir', addDir);
  return args;
}

/** Build the inner command arg list for copilot. Returns an array of literal args. */
function buildCopilotArgs(prompt: string, addDir: string | undefined): string[] {
  const args = ['copilot'];
  if (addDir) args.push('--add-dir', addDir);
  args.push('--allow-tool=shell', '-i', prompt);
  return args;
}

/** Build the inner command arg list to resume a claude session. */
function buildClaudeResumeArgs(sessionId: string): string[] {
  return ['claude', '--resume', sessionId];
}

/** Build the inner command arg list to resume a copilot session. */
function buildCopilotResumeArgs(sessionId: string): string[] {
  return ['copilot', `--resume=${sessionId}`];
}

interface SpawnAttempt { file: string; args: string[] }

/**
 * Per-platform ordered spawn attempts: attempts[0] is the tab form on
 * platforms that have one; the LAST entry is always the window form that
 * shipped before this change, byte for byte. macOS has no scriptable
 * new-tab verb (driving one requires synthetic keystrokes through System
 * Events, out of scope), so it keeps its single window-opening attempt.
 */
function buildSpawnAttempts(
  platform: NodeJS.Platform,
  payload: { cwd: string; encoded: string; shell: string; script: string },
): SpawnAttempt[] {
  if (platform === 'win32') {
    const windowArgs = ['--startingDirectory', payload.cwd, 'powershell', '-NoExit', '-EncodedCommand', payload.encoded];
    return [
      { file: 'wt', args: ['-w', '0', 'new-tab', ...windowArgs] },
      { file: 'wt', args: windowArgs },
    ];
  }
  if (platform === 'darwin') {
    return [{ file: 'osascript', args: ['-e', payload.script] }];
  }
  const windowArgs = ['--', 'bash', '-c', payload.shell];
  return [
    { file: 'gnome-terminal', args: ['--tab', ...windowArgs] },
    { file: 'gnome-terminal', args: windowArgs },
  ];
}

/**
 * Fire spawn attempts in order, advancing to the next attempt on either
 * failure mode: a synchronous throw from `spawn`, or an asynchronous
 * `error` event on the returned child — the path a real missing binary
 * takes, since `ENOENT` from `spawn` surfaces asynchronously rather than as
 * a throw. Each attempt advances at most once. The last attempt still has
 * nowhere to fall back to: a synchronous throw propagates to the caller, and
 * its `error` listener has no next attempt to fire — it exists purely to
 * swallow the event so it can't become an uncaught exception. The winning
 * attempt is never reported back — `launchTerminal` returns synchronously
 * once the first attempt is fired, before any asynchronous fallback could
 * resolve.
 */
function fireSpawnAttempts(spawn: SpawnFn, attempts: readonly SpawnAttempt[], env: NodeJS.ProcessEnv): void {
  const fire = (index: number): void => {
    const attempt = attempts[index]!;
    const isLast = index === attempts.length - 1;
    try {
      const child = spawn(attempt.file, attempt.args, { detached: true, stdio: 'ignore', env });
      let advanced = false;
      child.on?.('error', () => {
        if (advanced) return;
        advanced = true;
        if (!isLast) fire(index + 1);
      });
      child.unref();
    } catch (e) {
      if (isLast) throw e;
      fire(index + 1);
    }
  };
  fire(0);
}

export function launchTerminal(opts: TerminalLaunchOptions): TerminalLaunchResult {
  const platform = opts.platform ?? process.platform;
  const agent = opts.agent;

  if (!(opts.cwdExists ?? fs.existsSync)(opts.cwd)) {
    return { ok: false, platform, agent, error: `Launch directory no longer exists: ${opts.cwd}` };
  }

  const spawn = opts.spawn ?? (defaultSpawn as unknown as SpawnFn);
  const repaired = repairMsysPrompt(opts.prompt);
  const launchEnv = sanitizeLaunchEnv(agent, opts.env);   // top-level session: drop inherited markers for this agent

  let agentArgs: string[] = [];
  if (opts.resumeSessionId) {
    if (agent === 'claude') {
      agentArgs = buildClaudeResumeArgs(opts.resumeSessionId);
    } else if (agent === 'copilot') {
      agentArgs = buildCopilotResumeArgs(opts.resumeSessionId);
    }
  } else if (agent === 'claude') {
    agentArgs = buildClaudeArgs(repaired ?? '', opts.permissionMode ?? 'auto', opts.addDir, opts.model);
  } else if (agent === 'copilot') {
    agentArgs = buildCopilotArgs(repaired ?? '', opts.addDir);
  } else if (agent === 'vscode') {
    agentArgs = ['code', opts.cwd];
  }
  // terminal: no inner args; just cd to cwd

  try {
    const shellQuotedAgent = agentArgs.length > 0
      ? `${agentArgs[0]} ${agentArgs.slice(1).map(quoteSingle).join(' ')}`
      : '';

    let encoded = '';
    let shell = '';
    let script = '';

    if (platform === 'win32') {
      // PowerShell single-quoted literals use '' (doubled) to escape an
      // embedded single quote, NOT the POSIX '\'' form. Build the win32
      // payload with quoteSinglePwsh so paths/prompts containing ' survive
      // the Base64-encoded UTF-16LE PowerShell payload intact.
      const cdPartPwsh = `Set-Location ${quoteSinglePwsh(opts.cwd)}`;
      const shellQuotedAgentPwsh = agentArgs.length > 0
        ? `${agentArgs[0]} ${agentArgs.slice(1).map(quoteSinglePwsh).join(' ')}`
        : '';
      const clearEnvPrefix = agent === 'claude' ? `${CLEAR_ENV_PWSH} ` : '';
      const psCmd = shellQuotedAgentPwsh
        ? `${clearEnvPrefix}${cdPartPwsh}; ${shellQuotedAgentPwsh}`
        : `${clearEnvPrefix}${cdPartPwsh}`;
      encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
    } else if (platform === 'darwin') {
      const bashCd = `cd ${quoteSingle(opts.cwd)}`;
      const shellCmd = shellQuotedAgent
        ? `${bashCd} && ${shellQuotedAgent}`
        : bashCd;
      const appleScriptEscaped = shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      script = `tell application "Terminal" to do script "${appleScriptEscaped}"`;
    } else {
      const bashCd = `cd ${quoteSingle(opts.cwd)}`;
      shell = shellQuotedAgent
        ? `${bashCd} && ${shellQuotedAgent}; exec bash`
        : `${bashCd}; exec bash`;
    }

    const attempts = buildSpawnAttempts(platform, { cwd: opts.cwd, encoded, shell, script });
    fireSpawnAttempts(spawn, attempts, launchEnv);
  } catch (e) {
    return { ok: false, platform, agent, error: (e as Error).message };
  }

  const out: TerminalLaunchResult = { ok: true, platform, agent };
  if (agent === 'claude' && opts.permissionMode) out.permissionMode = opts.permissionMode;
  return out;
}
