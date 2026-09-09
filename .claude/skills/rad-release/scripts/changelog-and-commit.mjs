#!/usr/bin/env node
// CHANGELOG approval gate and atomic release commit.
//
// draftChangelog — produces a ## v{version} — {date} block with three sections:
//   ### What's New  (feat: commits)
//   ### What's Fixed (fix: commits)
//   ### Changes     (all other commits)
//
// commitRelease — prepends the approved CHANGELOG entry and lands exactly one
//   git commit with subject "chore: bump version to v{version}".

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Draft a CHANGELOG entry for the given version.
 *
 * @param {{ version: string, commits: string[], date?: string }} opts
 * @returns {Promise<string>} Markdown text for the new CHANGELOG block.
 */
export async function draftChangelog({ version, commits, date = new Date().toISOString().slice(0, 10) }) {
  const newFeatures = commits.filter(c => c.startsWith('feat')).map(c => `- ${c}`).join('\n');
  const fixes = commits.filter(c => c.startsWith('fix')).map(c => `- ${c}`).join('\n');
  const changes = commits.filter(c => !c.startsWith('feat') && !c.startsWith('fix')).map(c => `- ${c}`).join('\n');
  return [
    `## v${version} — ${date}`,
    '',
    `### What's New`,
    newFeatures || '_(none)_',
    '',
    `### What's Fixed`,
    fixes || '_(none)_',
    '',
    `### Changes`,
    changes || '_(none)_',
    '',
  ].join('\n');
}

/**
 * Prepend the approved CHANGELOG entry then land exactly one git commit.
 *
 * @param {{
 *   repoRoot: string,
 *   version: string,
 *   approvedChangelog: string,
 *   spawn?: Function,
 *   writeFile?: Function,
 * }} opts
 */
export async function commitRelease({
  repoRoot,
  version,
  approvedChangelog,
  spawn = spawnSync,
  writeFile = fs.promises.writeFile,
}) {
  // Prepend the approved entry to CHANGELOG.md above the previous most-recent entry.
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
  const existing = fs.existsSync(changelogPath)
    ? await fs.promises.readFile(changelogPath, 'utf8')
    : '# Changelog\n\n---\n\n';
  // Anchor to a line-start "## v" heading only — a bare indexOf('## v') can
  // false-match inline-code prose elsewhere in the file (e.g. the intro
  // sentence's `` `## v{version}` ``) and splice the new entry mid-sentence.
  const headingMatch = existing.match(/^## v/m);
  const insertionPoint = headingMatch ? headingMatch.index : -1;
  const updated =
    insertionPoint === -1
      ? existing + approvedChangelog + '\n'
      : existing.slice(0, insertionPoint) + approvedChangelog + '\n' + existing.slice(insertionPoint);
  await writeFile(changelogPath, updated, 'utf8');

  // Stage everything (bumped carriers, renamed manifest catalogs already
  // git-mv'd by bump-version.mjs, regenerated per-harness manifest files, CHANGELOG)
  // and land exactly one commit.
  const add = spawn('git', ['add', '-A'], { cwd: repoRoot, encoding: 'utf8' });
  if (add.status !== 0) throw new Error('git add failed: ' + add.stderr);

  const commit = spawn(
    'git',
    ['commit', '-m', `chore: bump version to v${version}`],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (commit.status !== 0) throw new Error('git commit failed: ' + commit.stderr);
}

// -----------------------------------------------------------------------------
// CLI entry point — `node changelog-and-commit.mjs --draft --to <version>`
// -----------------------------------------------------------------------------
// SKILL.md step 5 invokes this file directly with `--draft`. It gathers the
// commit subjects since the last v* tag itself (full history on first release)
// and prints the drafted block for the operator's approval gate. Without this
// block the process would exit 0 printing nothing, and the gate would be
// presented against an empty draft.
//
// `commitRelease` is deliberately NOT reachable from the CLI: it writes
// CHANGELOG.md and lands the single release commit, and must only run after the
// operator has approved a body. Step 6 imports and calls it.

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? undefined : argv[i + 1]; };
  const version = flag('--to');
  const repoRoot = flag('--repo-root') || process.cwd();
  if (!argv.includes('--draft') || !version) {
    console.error('usage: changelog-and-commit.mjs --draft --to <version> [--repo-root <dir>]');
    process.exit(1);
  }
  // A tag name is repository data, not a trusted literal — git permits `$()`,
  // backticks and semicolons in a ref. Build the range as a single argv entry
  // and hand it to spawnSync WITHOUT a shell, so a hostile tag can only ever be
  // an unresolvable revision rather than a command.
  const args = ['log', '--format=%s'];
  try {
    const described = spawnSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], {
      cwd: repoRoot, encoding: 'utf8',
    });
    if (described.status === 0) {
      const tag = described.stdout.trim();
      if (tag) args.push(`${tag}..HEAD`);
    }
  } catch { /* no tags yet — full history */ }
  const logged = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (logged.status !== 0) {
    console.error(`git log failed: ${logged.stderr || 'unknown error'}`);
    process.exit(1);
  }
  const commits = logged.stdout
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  draftChangelog({ version, commits }).then(
    (body) => process.stdout.write(body),
    (err) => { console.error(err.message); process.exit(1); },
  );
}
