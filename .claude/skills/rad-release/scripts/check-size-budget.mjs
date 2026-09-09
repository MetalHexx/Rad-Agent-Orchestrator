import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isWin = process.platform === 'win32';

// 50 MB ceiling + 10% headroom = 57,671,680 bytes
export const SIZE_BUDGET_BYTES = 57_671_680;

const PLUGINS = [
  'harness-installers/claude-plugin',
  'harness-installers/copilot-cli-plugin',
  'harness-installers/copilot-vscode-plugin',
];

export async function checkSizeBudget({ repoRoot, spawn = spawnSync }) {
  const failures = [];
  for (const dir of PLUGINS) {
    const cwd = path.join(repoRoot, dir, 'output');
    const res = spawn('npm', ['pack', '--dry-run', '--json'], { cwd, encoding: 'utf8', shell: isWin });
    if (res.status !== 0) {
      return { ok: false, error: `${dir}: npm pack failed: ${res.stderr}` };
    }
    const [meta] = JSON.parse(res.stdout);
    if (meta.unpackedSize > SIZE_BUDGET_BYTES) {
      failures.push(`${dir}: ${meta.unpackedSize} > budget ${SIZE_BUDGET_BYTES}`);
    }
  }
  if (failures.length) {
    return { ok: false, error: failures.join('; ') };
  }
  return { ok: true };
}

// -----------------------------------------------------------------------------
// CLI entry point — `node check-size-budget.mjs [--repo-root <dir>]`
// -----------------------------------------------------------------------------
// SKILL.md step 4 invokes this file directly; see build-and-validate.mjs for
// why a missing entry point is worse than a loud failure.

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--repo-root');
  checkSizeBudget({ repoRoot: i === -1 ? process.cwd() : process.argv[i + 1] }).then(
    (res) => {
      if (!res.ok) { console.error(res.error); process.exit(1); }
      console.log(`size budget ok (all plugins under ${SIZE_BUDGET_BYTES} bytes)`);
    },
    (err) => { console.error(err.message); process.exit(1); },
  );
}
