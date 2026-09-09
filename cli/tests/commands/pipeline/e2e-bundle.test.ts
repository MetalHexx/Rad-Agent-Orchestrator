import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const execP = promisify(execFile);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const TEMPLATES_DIR = path.resolve(repoRoot, '..', 'runtime-config', 'templates');
const ACTION_EVENTS_DIR = path.resolve(repoRoot, '..', 'runtime-config', 'action-events');

describe('pipeline signal end-to-end via the built bundle', () => {
  it('emits a canonical envelope on stdout for `start`', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-e2e-'));
    fs.copyFileSync(path.join(TEMPLATES_DIR, 'medium.yml'), path.join(dir, 'template.yml'));
    const { stdout } = await execP('node', [
      'dist/bin/radorch.js', 'pipeline', 'signal',
      '--event', 'start', '--project-dir', dir, '--template', 'medium',
    ], { cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: TEMPLATES_DIR, RADORCH_ACTION_EVENTS_DIR: ACTION_EVENTS_DIR } });
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    // Success envelopes carry prompt, completion_event and completion_commands
    // at the top level of data.
    expect(Object.keys(env.data).sort()).toEqual(
      ['action', 'completion_commands', 'completion_event', 'context', 'has_custom_instructions', 'prompt'],
    );
  }, 60_000);
});
