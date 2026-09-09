import os from 'node:os';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import {
  launchTerminal,
  LAUNCH_AGENTS,
  VALID_PERMISSION_MODES,
  type LaunchAgent,
  type PermissionMode,
} from '@rad-orchestration/terminal-launch';

export { LAUNCH_AGENTS, VALID_PERMISSION_MODES };
export type { LaunchAgent, PermissionMode };

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
    return launchTerminal({
      agent: validated.agent, cwd: wt,
      prompt: validated.prompt, permissionMode: validated.permissionMode,
      addDir: path.join(os.homedir(), '.radorc', 'projects'), model: 'sonnet',
    });
  },
});
