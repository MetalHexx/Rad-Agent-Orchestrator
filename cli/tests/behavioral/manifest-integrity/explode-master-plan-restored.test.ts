import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const ACTION_FILE = join(REPO_ROOT, 'runtime-config', 'action-events', 'action.explode_master_plan.md');
const MANIFESTS = [
  join(REPO_ROOT, 'harness-installers', 'standard', 'manifests', 'claude', 'v1.0.0-alpha.13.json'),
  join(REPO_ROOT, 'harness-installers', 'standard', 'manifests', 'copilot-cli', 'v1.0.0-alpha.13.json'),
  join(REPO_ROOT, 'harness-installers', 'standard', 'manifests', 'copilot-vscode', 'v1.0.0-alpha.13.json'),
];
const CANONICAL_COMMAND = '`radorch.mjs plan explode`';

describe('action.explode_master_plan.md is intact and listed in every manifest', () => {
  it('action file contains the canonical radorch.mjs command on line 10', () => {
    const body = readFileSync(ACTION_FILE, 'utf8');
    const line10 = body.split(/\r?\n/)[9];
    expect(line10).toContain(CANONICAL_COMMAND);
    // Regression guard: bare-filename stray-quote signature (backtick before
    // bare filename followed by a stray double-quote before the subcommand).
    expect(line10).not.toContain('`radorch.mjs" plan');
  });

  it('all three standard manifests carry the action.explode_master_plan.md entry', () => {
    for (const manifestPath of MANIFESTS) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const entry = manifest.files.find((f: { bundlePath: string }) =>
        f.bundlePath === 'action-events/action.explode_master_plan.md'
      );
      expect(entry, `${manifestPath} missing entry`).toBeDefined();
      expect(entry.destinationPath, `${manifestPath} entry destination`).toBe(
        '${RAD_HOME}/action-events/action.explode_master_plan.md'
      );
    }
  });
});
