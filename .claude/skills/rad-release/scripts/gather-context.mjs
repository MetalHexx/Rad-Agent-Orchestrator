import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function gatherContext({ repoRoot }) {
  const cliPkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'cli', 'package.json'), 'utf8')
  );
  const currentVersion = cliPkg.version;
  const currentBranch = execSync('git branch --show-current', { cwd: repoRoot, encoding: 'utf8' }).trim();
  const workingTreeDirty = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).trim() !== '';
  let lastReleaseTag = null;
  try {
    lastReleaseTag = execSync('git describe --tags --abbrev=0 --match "v*"', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch { /* no tags yet — fine */ }
  return { currentVersion, currentBranch, workingTreeDirty, lastReleaseTag };
}

// -----------------------------------------------------------------------------
// CLI entry point — `node gather-context.mjs [--repo-root <dir>]`
// -----------------------------------------------------------------------------
// SKILL.md step 1 invokes this file directly. Without this block the process
// would exit 0 having done nothing, which reads as success.

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--repo-root');
  gatherContext({ repoRoot: i === -1 ? process.cwd() : process.argv[i + 1] }).then(
    (ctx) => {
      for (const [k, v] of Object.entries(ctx)) console.log(`${k}: ${v === null ? 'none yet' : v}`);
    },
    (err) => { console.error(err.message); process.exit(1); },
  );
}
