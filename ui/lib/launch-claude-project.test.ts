/**
 * Tests for ui/lib/launch-claude-project.js
 *
 * Runs the script in a subprocess with LAUNCH_CLAUDE_PROJECT_DRY_RUN=1 so
 * the platform-specific spawn() is skipped and no real terminal is opened.
 * Assertions are made against the script's single-line JSON stdout contract.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, 'launch-claude-project.js');

function runLauncher(args: string[], env: NodeJS.ProcessEnv = {} as unknown as NodeJS.ProcessEnv): { stdout: string; status: number | null } {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env, LAUNCH_CLAUDE_PROJECT_DRY_RUN: '1' },
  });
  return { stdout: res.stdout, status: res.status };
}

// Missing args → JSON error + non-zero exit
{
  const { stdout, status } = runLauncher([]);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.success, false);
  assert.match(parsed.error, /Missing required args/);
  assert.notEqual(status, 0);
  console.log('✓ missing args → JSON error + non-zero exit');
}

// Invalid permission mode → JSON error
{
  const { stdout, status } = runLauncher([
    '--workspace-root', 'C:/tmp',
    '--prompt', '/rad-brainstorm FOO',
    '--permission-mode', 'nope',
  ]);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.success, false);
  assert.match(parsed.error, /Invalid --permission-mode/);
  assert.notEqual(status, 0);
  console.log('✓ invalid permission mode → JSON error');
}

// Happy path (dry-run) → success JSON with platform + permissionMode
{
  const { stdout, status } = runLauncher([
    '--workspace-root', process.cwd(),
    '--prompt', '/rad-brainstorm FOO',
  ]);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.success, true);
  assert.equal(typeof parsed.platform, 'string');
  assert.equal(parsed.permissionMode, 'auto');
  assert.equal(status, 0);
  console.log('✓ dry-run happy path → success JSON (platform + permissionMode=auto)');
}

// Top-level-session contract: launcher strips inherited CLAUDECODE / CLAUDE_CODE_*
// (reported via removedEnvKeys under dry-run) but preserves CLAUDE_EFFORT.
{
  const { stdout, status } = runLauncher(
    ['--workspace-root', process.cwd(), '--prompt', '/rad-brainstorm FOO'],
    { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_EFFORT: 'high' } as unknown as NodeJS.ProcessEnv,
  );
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.success, true);
  assert.ok(Array.isArray(parsed.removedEnvKeys), 'removedEnvKeys present under dry-run');
  assert.ok(parsed.removedEnvKeys.includes('CLAUDECODE'));
  assert.ok(parsed.removedEnvKeys.includes('CLAUDE_CODE_ENTRYPOINT'));
  assert.ok(!parsed.removedEnvKeys.includes('CLAUDE_EFFORT'));
  assert.equal(status, 0);
  console.log('✓ dry-run strips CLAUDECODE/CLAUDE_CODE_* and preserves CLAUDE_EFFORT');
}

// Non-Error throw at top level → catch fallback uses String(err)
{
  const { stdout, status } = runLauncher(
    ['--workspace-root', process.cwd(), '--prompt', '/rad-brainstorm FOO'],
    { LAUNCH_CLAUDE_PROJECT_FORCE_NON_ERROR_THROW: '1' } as unknown as NodeJS.ProcessEnv,
  );
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.success, false);
  assert.equal(parsed.error, 'string not error');
  assert.notEqual(status, 0);
  console.log('✓ non-Error throw → catch uses String(err) fallback');
}

console.log('\nAll launch-claude-project tests passed');
