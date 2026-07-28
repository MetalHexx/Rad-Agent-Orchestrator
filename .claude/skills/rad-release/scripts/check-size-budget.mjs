import { spawnSync } from 'node:child_process';
import path from 'node:path';

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
