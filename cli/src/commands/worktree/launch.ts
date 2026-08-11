import os from 'node:os';
import path from 'node:path';
import { spawn as defaultSpawn } from 'node:child_process';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';

export type LaunchAgent = 'claude' | 'copilot' | 'vscode' | 'terminal';
export const LAUNCH_AGENTS: readonly LaunchAgent[] = ['claude', 'copilot', 'vscode', 'terminal'];
export const VALID_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'auto', 'dontAsk', 'plan'] as const;
export type PermissionMode = typeof VALID_PERMISSION_MODES[number];

export interface ValidateInput {
  agent: string | undefined;
  prompt: string | undefined;
  permissionMode: string | undefined;
}
export type ValidateResult =
  | { ok: true; agent: LaunchAgent; prompt: string | undefined; permissionMode: PermissionMode | undefined }
  | { ok: false; error: { type: 'user_error'; message: string } };

export function validateLaunchFlags(input: ValidateInput): ValidateResult {
  const agent = input.agent;
  if (!agent || !(LAUNCH_AGENTS as readonly string[]).includes(agent)) {
    return { ok: false, error: { type: 'user_error', message: `--agent must be one of: ${LAUNCH_AGENTS.join(', ')}` } };
  }
  const a = agent as LaunchAgent;
  const promptRequired = a === 'claude' || a === 'copilot';
  if (promptRequired && (!input.prompt || input.prompt === '')) {
    return { ok: false, error: { type: 'user_error', message: `--prompt is required when --agent is ${a}` } };
  }
  if (!promptRequired && input.prompt) {
    return { ok: false, error: { type: 'user_error', message: `--prompt is not valid with --agent ${a}; valid only for claude or copilot` } };
  }
  if (input.permissionMode !== undefined && a !== 'claude') {
    return { ok: false, error: { type: 'user_error', message: `--permission-mode is only valid with --agent claude (got ${a})` } };
  }
  let pm: PermissionMode | undefined;
  if (a === 'claude') {
    const supplied = input.permissionMode ?? 'auto';
    if (!(VALID_PERMISSION_MODES as readonly string[]).includes(supplied)) {
      return { ok: false, error: { type: 'user_error', message: `--permission-mode invalid; valid values: ${VALID_PERMISSION_MODES.join(', ')}` } };
    }
    pm = supplied as PermissionMode;
  }
  return { ok: true, agent: a, prompt: input.prompt, permissionMode: pm };
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

type SpawnedChild = { unref: () => void; on?: (event: 'error', listener: (err: Error) => void) => unknown };
type SpawnFn = (file: string, args: readonly string[], opts: { detached: boolean; stdio: 'ignore'; env?: NodeJS.ProcessEnv }) => SpawnedChild;

/**
 * Build the env for a launched agent so the new Claude session comes up TOP-LEVEL,
 * not as a nested child of the session that spawned it.
 *
 * Claude Code marks a spawned process a *child session* when it inherits the
 * parent's `CLAUDECODE` / `CLAUDE_CODE_*` markers, and child sessions do not write
 * the flat `<session>.jsonl` transcript that telemetry reads — so worktree/pipeline
 * sessions captured nothing. Stripping exactly those markers makes every launch a
 * fresh top-level session. Everything else is preserved (PATH, HOME, and notably
 * `CLAUDE_EFFORT`, which is not a `CLAUDE_CODE_` var). Never mutates `process.env`.
 */
export function sanitizeLaunchEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(out)) {
    if (key === 'CLAUDECODE' || /^CLAUDE_CODE_/.test(key)) delete out[key];
  }
  return out;
}

// On Windows, `wt` may route the new tab through an existing Windows Terminal broker
// process, so the spawned shell can inherit the *broker's* env rather than the one we
// pass to spawn(). Belt-and-suspenders: also clear the markers inside the encoded
// PowerShell payload before launching the agent.
const CLEAR_ENV_PWSH =
  'Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue; '
  + 'Get-ChildItem Env:CLAUDE_CODE_* | Remove-Item -ErrorAction SilentlyContinue;';

export interface WorktreeLaunchOptions {
  agent: LaunchAgent;
  worktreePath: string;
  prompt?: string;
  permissionMode?: PermissionMode;
  platform?: NodeJS.Platform;
  spawn?: SpawnFn;
}

export interface WorktreeLaunchResult {
  ok: boolean;
  platform: NodeJS.Platform;
  agent: LaunchAgent;
  permissionMode?: PermissionMode;
  error?: string;
}

function quoteSingle(s: string): string { return `'${s.replace(/'/g, "'\\''")}'`; }

/**
 * PowerShell single-quoted literal escape.
 *
 * Inside a PowerShell `'...'` literal, the only character that needs escaping
 * is the single quote itself — and PowerShell's rule is to double it (`''`),
 * not the POSIX close-escape-reopen form (`'\''`). Using POSIX inside an
 * encoded PowerShell payload silently corrupts paths or prompts that contain
 * `'`. This helper is the win32 counterpart to {@link quoteSingle}.
 */
export function quoteSinglePwsh(s: string): string { return `'${s.replace(/'/g, "''")}'`; }

/** Build the inner command arg list for claude. Returns an array of literal args. */
function buildClaudeArgs(prompt: string, permissionMode: PermissionMode, addDir: string): string[] {
  return ['claude', '--permission-mode', permissionMode, '--model', 'sonnet', prompt, '--add-dir', addDir];
}

/** Build the inner command arg list for copilot. Returns an array of literal args. */
function buildCopilotArgs(prompt: string, addDir: string): string[] {
  return ['copilot', '--add-dir', addDir, '--allow-tool=shell', '-i', prompt];
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
  payload: { worktreePath: string; encoded: string; shell: string; script: string },
): SpawnAttempt[] {
  if (platform === 'win32') {
    const windowArgs = ['--startingDirectory', payload.worktreePath, 'powershell', '-NoExit', '-EncodedCommand', payload.encoded];
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
 * attempt is never reported back — `worktreeLaunch` returns synchronously
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

export function worktreeLaunch(opts: WorktreeLaunchOptions): WorktreeLaunchResult {
  const platform = opts.platform ?? process.platform;
  const spawn = opts.spawn ?? (defaultSpawn as unknown as SpawnFn);
  const repaired = repairMsysPrompt(opts.prompt);
  const addDir = path.join(os.homedir(), '.radorc', 'projects');
  const launchEnv = sanitizeLaunchEnv();   // top-level session: drop inherited CLAUDECODE/CLAUDE_CODE_*

  let agentArgs: string[] = [];
  if (opts.agent === 'claude') {
    agentArgs = buildClaudeArgs(repaired ?? '', opts.permissionMode ?? 'auto', addDir);
  } else if (opts.agent === 'copilot') {
    agentArgs = buildCopilotArgs(repaired ?? '', addDir);
  } else if (opts.agent === 'vscode') {
    agentArgs = ['code', opts.worktreePath];
  }
  // terminal: no inner args; just cd to worktree

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
      const cdPartPwsh = `Set-Location ${quoteSinglePwsh(opts.worktreePath)}`;
      const shellQuotedAgentPwsh = agentArgs.length > 0
        ? `${agentArgs[0]} ${agentArgs.slice(1).map(quoteSinglePwsh).join(' ')}`
        : '';
      const psCmd = shellQuotedAgentPwsh
        ? `${CLEAR_ENV_PWSH} ${cdPartPwsh}; ${shellQuotedAgentPwsh}`
        : `${CLEAR_ENV_PWSH} ${cdPartPwsh}`;
      encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
    } else if (platform === 'darwin') {
      const bashCd = `cd ${quoteSingle(opts.worktreePath)}`;
      const shellCmd = shellQuotedAgent
        ? `${bashCd} && ${shellQuotedAgent}`
        : bashCd;
      const appleScriptEscaped = shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      script = `tell application "Terminal" to do script "${appleScriptEscaped}"`;
    } else {
      const bashCd = `cd ${quoteSingle(opts.worktreePath)}`;
      shell = shellQuotedAgent
        ? `${bashCd} && ${shellQuotedAgent}; exec bash`
        : `${bashCd}; exec bash`;
    }

    const attempts = buildSpawnAttempts(platform, { worktreePath: opts.worktreePath, encoded, shell, script });
    fireSpawnAttempts(spawn, attempts, launchEnv);
  } catch (e) {
    return { ok: false, platform, agent: opts.agent, error: (e as Error).message };
  }

  const out: WorktreeLaunchResult = { ok: true, platform, agent: opts.agent };
  if (opts.agent === 'claude' && opts.permissionMode) out.permissionMode = opts.permissionMode;
  return out;
}

interface Args {
  agent?: string;
  'worktree-path'?: string;
  prompt?: string;
  'permission-mode'?: string;
}

const LAUNCH_DESCRIPTION = [
  'Open a terminal at the worktree and launch the chosen agent',
  '',
  '--prompt required for: claude, copilot · rejected for: vscode, terminal',
  '--permission-mode only valid with: claude (default: auto)',
].join('\n');

export const worktreeLaunchCommand = defineCommand({
  name: 'worktree-launch',
  description: LAUNCH_DESCRIPTION,
  args: {
    agent: { description: 'Launch target: `claude`, `copilot`, `vscode`, or `terminal`', required: true },
    'worktree-path': { description: 'Absolute path to the worktree the new terminal opens in', required: true },
    prompt: { description: 'Initial prompt; required when --agent is `claude` or `copilot`, rejected otherwise' },
    'permission-mode': {
      description: 'Claude permission mode (default `auto`); valid values: default, acceptEdits, bypassPermissions, auto, dontAsk, plan',
    },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    const wt = args['worktree-path'];
    if (!wt) throw new UserError('--worktree-path is required');
    const validated = validateLaunchFlags({
      agent: args.agent, prompt: args.prompt, permissionMode: args['permission-mode'],
    });
    if (!validated.ok) throw new UserError(validated.error.message);
    return worktreeLaunch({
      agent: validated.agent, worktreePath: wt,
      prompt: validated.prompt, permissionMode: validated.permissionMode,
    });
  },
});
