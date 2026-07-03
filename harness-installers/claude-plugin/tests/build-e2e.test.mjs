import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The e2e harness drives the real build from repo root. The build invokes
// the adapter engine first, then every helper. UI build is real;
// expect ~10-30s for the full run. Skipped when SKIP_E2E=1.
test('end-to-end build produces a valid plugin payload', { skip: process.env.SKIP_E2E === '1' }, () => {
  const repoRoot = REPO_ROOT;
  execSync('node harness-installers/claude-plugin/build-scripts/build.js', {
    cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32',
  });
  const out = join(repoRoot, 'harness-installers/claude-plugin/output');
  // Required surfaces present.
  for (const rel of [
    '.claude-plugin/plugin.json',
    'package.json',
    'agents/coder.md',
    'skills/rad-orchestration/SKILL.md',
    'skills/rad-orchestration/scripts/radorch.mjs',
    'hooks/hooks.json',
    'hooks/bootstrap.mjs',
    'hooks/drift-check.mjs',
    '_install-source/orchestration.yml',
    '_install-source/templates/medium.yml',
    '_install-source/ui.tgz',
  ]) {
    assert.ok(fs.existsSync(join(out, rel)), `missing ${rel}`);
  }
  // No leftover bin/ or build-scripts/.
  assert.ok(!fs.existsSync(join(out, 'bin')), 'no bin/');
  assert.ok(!fs.existsSync(join(out, 'build-scripts')), 'no build-scripts/');

  // npm pack --dry-run --json succeeds and reports size under budget.
  const packOut = execSync('npm pack --dry-run --json', {
    cwd: out, shell: process.platform === 'win32', encoding: 'utf8',
  });
  const parsed = JSON.parse(packOut);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const size = entry?.unpackedSize ?? entry?.size ?? 0;
  const limit = Math.round(50 * 1024 * 1024 * 1.1);
  assert.ok(size > 0 && size <= limit, `pack size ${size} must be > 0 and ≤ ${limit}`);
});
