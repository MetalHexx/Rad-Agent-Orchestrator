'use strict';

/**
 * launch-claude-project.js
 *
 * Cross-platform launcher: opens a new terminal window at the given
 * workspace root and starts Claude Code with a slash-prefixed prompt.
 * Modeled on the worktree-launch path now folded into /rad-execute,
 * but with a project-scoped arg surface: no worktree path, no
 * --add-dir, a single workspace root that becomes the cwd.
 *
 * Usage:
 *   node launch-claude-project.js --workspace-root <path> --prompt <string> [--permission-mode <mode>]
 *
 * Output: JSON to stdout { success: true, platform, permissionMode }
 *         or            { success: false, error }
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS node subprocess script; ui/package.json has no "type": "module"
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] ?? null : null;
};

const workspaceRoot  = getArg('--workspace-root');
const prompt         = getArg('--prompt');
const permissionMode = getArg('--permission-mode') || 'auto';

const VALID_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'auto', 'dontAsk', 'plan'];
if (!VALID_MODES.includes(permissionMode)) {
  process.stdout.write(JSON.stringify({
    success: false,
    error: `Invalid --permission-mode '${permissionMode}'. Must be one of: ${VALID_MODES.join(', ')}`,
  }) + '\n');
  process.exit(1);
}

if (!workspaceRoot || !prompt) {
  process.stdout.write(JSON.stringify({
    success: false,
    error: 'Missing required args: --workspace-root and --prompt',
  }) + '\n');
  process.exit(1);
}

function buildClaudeCmd() {
  // Prompt is slash-prefixed at the caller; single-quoted here to match
  // the worktree-launch path now folded into /rad-execute. See NFR-4.
  return `claude --permission-mode ${permissionMode} '${prompt}'`;
}

/**
 * Build the env for the launched Claude session so it comes up TOP-LEVEL, not as a
 * nested child of the dashboard's own process tree. Claude Code marks a spawned
 * process a child session when it inherits CLAUDECODE / CLAUDE_CODE_*; child sessions
 * do not write the flat transcript telemetry reads. Strip exactly those markers and
 * keep everything else (PATH, HOME, CLAUDE_EFFORT). Returns { env, removed } so the
 * dry-run path can report exactly what was stripped. Never mutates the input.
 */
function sanitizeLaunchEnv(env) {
  const out = { ...env };
  const removed = [];
  for (const key of Object.keys(out)) {
    if (key === 'CLAUDECODE' || /^CLAUDE_CODE_/.test(key)) { removed.push(key); delete out[key]; }
  }
  return { env: out, removed };
}

// On Windows, `wt` may route the new tab through an existing Windows Terminal broker,
// so the spawned shell can inherit the broker's env rather than ours. Belt-and-
// suspenders: also clear the markers inside the encoded PowerShell payload.
const CLEAR_ENV_PWSH =
  'Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue; '
  + 'Get-ChildItem Env:CLAUDE_CODE_* | Remove-Item -ErrorAction SilentlyContinue;';

const { env: launchEnv, removed: removedEnvKeys } = sanitizeLaunchEnv(process.env);

function launchWindows() {
  const escapedRoot = workspaceRoot.replace(/'/g, "''");
  const innerCmd = `${CLEAR_ENV_PWSH} Set-Location '${escapedRoot}'; ${buildClaudeCmd()}`;
  const encoded  = Buffer.from(innerCmd, 'utf16le').toString('base64');
  const child = spawn(
    'wt',
    ['--startingDirectory', workspaceRoot, 'powershell', '-NoExit', '-EncodedCommand', encoded],
    { detached: true, stdio: 'ignore', env: launchEnv }
  );
  child.on('error', (err) => {
    process.stderr.write(`launch-claude-project: spawn error: ${err.message}\n`);
  });
  child.unref();
}

function launchMac() {
  const escapedRoot = workspaceRoot.replace(/'/g, "'\\''");
  const cmd     = `cd '${escapedRoot}' && ${buildClaudeCmd()}`;
  const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const child = spawn(
    'osascript',
    ['-e', `tell application "Terminal" to do script "${escaped}"`],
    { detached: true, stdio: 'ignore', env: launchEnv }
  );
  child.on('error', (err) => {
    process.stderr.write(`launch-claude-project: spawn error: ${err.message}\n`);
  });
  child.unref();
}

function launchLinux() {
  const escapedRoot = workspaceRoot.replace(/'/g, "'\\''");
  const cmd = `cd '${escapedRoot}' && ${buildClaudeCmd()}; exec bash`;
  const child = spawn(
    'gnome-terminal',
    ['--', 'bash', '-c', cmd],
    { detached: true, stdio: 'ignore', env: launchEnv }
  );
  child.on('error', (err) => {
    process.stderr.write(`launch-claude-project: spawn error: ${err.message}\n`);
  });
  child.unref();
}

try {
  const platform = process.platform;
  const dryRun = process.env.LAUNCH_CLAUDE_PROJECT_DRY_RUN === '1';
  const forceFail = process.env.LAUNCH_CLAUDE_PROJECT_FORCE_FAIL === '1';
  const forceNonErrorThrow = process.env.LAUNCH_CLAUDE_PROJECT_FORCE_NON_ERROR_THROW === '1';

  if (forceNonErrorThrow) {
    throw 'string not error';
  }

  if (forceFail) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: 'Forced failure for testing.',
    }) + '\n');
    process.exit(1);
  }

  if (!dryRun) {
    if (platform === 'win32')       launchWindows();
    else if (platform === 'darwin') launchMac();
    else                            launchLinux();
  }

  const result = { success: true, platform, permissionMode };
  // Dry-run only: surface exactly which inherited markers the launch stripped, so
  // the top-level-session contract is testable without spawning a real terminal.
  if (dryRun) result.removedEnvKeys = removedEnvKeys;
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ success: false, error: message }) + '\n');
  process.exit(1);
}
