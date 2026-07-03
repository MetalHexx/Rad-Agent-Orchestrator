#!/usr/bin/env node
// Lockstep version-bump engine.
//
// Bumps a single carrier inventory in one atomic pass:
//   1. Wrapper `package.json` files — in-place JSON edit
//   2. Plugin authoritative version sources — in-place JSON edit
//   3. Per-version manifest catalog files — `git mv` rename + internal `version` field update
//   4. Hardcoded-literal files — bare string replacement
//   5. Stray-carrier guard — `git grep -l <from>` and fail loudly on any unlisted carrier
//
// All edits are made relative to `repoRoot`. CLI wrapper:
//   node bump-version.mjs --from <prev> --to <next>

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// -----------------------------------------------------------------------------
// Carrier inventory
// -----------------------------------------------------------------------------

// 1. Wrapper package.json files (9) — JSON, in-place `version` bump.
export const WRAPPER_JSON_FILES = [
  'cli/package.json',
  'ui/package.json',
  'lib/repo-registry/package.json',
  'harness-adapters/engine/package.json',
  'harness-installers/standard/package.json',
  'harness-installers/shared/build-helpers/package.json',
  'harness-installers/claude-plugin/package.json',
  'harness-installers/copilot-cli-plugin/package.json',
  'harness-installers/copilot-vscode-plugin/package.json',
];

// 2. Plugin authoritative version sources (3) — JSON, in-place `version` bump.
// The Claude plugin and the Copilot-VSCode plugin store the authoritative
// plugin.json under `.claude-plugin/`; the Copilot-CLI plugin keeps it at the
// package root.
export const PLUGIN_JSON_FILES = [
  'harness-installers/claude-plugin/.claude-plugin/plugin.json',
  'harness-installers/copilot-cli-plugin/plugin.json',
  'harness-installers/copilot-vscode-plugin/.claude-plugin/plugin.json',
];

// 3. Per-version manifest catalog directories (6) — files named `v<version>.json`
// inside each dir get `git mv`-renamed + internal `version` field bumped.
export const MANIFEST_DIRS = [
  'harness-installers/claude-plugin/manifests',
  'harness-installers/copilot-cli-plugin/manifests',
  'harness-installers/copilot-vscode-plugin/manifests',
  'harness-installers/standard/manifests/claude',
  'harness-installers/standard/manifests/copilot-cli',
  'harness-installers/standard/manifests/copilot-vscode',
];

// 4. Hardcoded-literal files (12) — bare `from` string replaced everywhere.
export const HARDCODED_LITERAL_FILES = [
  'harness-installers/claude-plugin/build-scripts/parity-check.js',
  'harness-installers/claude-plugin/tests/manifest-shape.test.mjs',
  'harness-installers/claude-plugin/tests/build-payload.test.mjs',
  'harness-installers/copilot-cli-plugin/tests/build-payload.test.mjs',
  'harness-installers/copilot-vscode-plugin/tests/build-payload.test.mjs',
  'harness-installers/standard/tests/build/build.test.mjs',
  'harness-installers/standard/tests/build/emit-manifest.test.mjs',
  'harness-installers/standard/tests/build/validate.test.mjs',
  'harness-installers/standard/tests/install/uninstall-harness.test.mjs',
  'harness-installers/standard/tests/integration/build-then-install.test.mjs',
  'harness-installers/standard/tests/lib/drift-hint.test.mjs',
  'harness-installers/standard/tests/lib/wizard.test.mjs',
];

// Auto-stamped / legacy-comment carriers that are intentionally excluded from
// the stray-carrier guard. `runtime-config/orchestration.yml` is regenerated
// downstream; `CHANGELOG.md` legacy comments preserve history.
const GUARD_EXCLUDED_FILES = new Set([
  'runtime-config/orchestration.yml',
  'CHANGELOG.md',
]);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function normalizeRelative(p) {
  // git grep returns forward-slash paths; normalize anything we compare to it.
  return p.split(path.sep).join('/');
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function writeJsonPreservingTrailingNewline(absPath, obj) {
  // Preserve 2-space indent + trailing newline convention used by all
  // wrapper / plugin manifests in the repo.
  fs.writeFileSync(absPath, JSON.stringify(obj, null, 2) + '\n');
}

function bumpJsonFile(repoRoot, relPath, from, to, kind) {
  const abs = path.join(repoRoot, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`${kind} not found: ${relPath}`);
  }
  const json = readJson(abs);
  if (json.version !== from) {
    throw new Error(
      `${kind} ${relPath} has version "${json.version}", expected "${from}"`,
    );
  }
  json.version = to;
  writeJsonPreservingTrailingNewline(abs, json);
}

function bumpManifestCatalogFile(repoRoot, dir, from, to) {
  const oldRel = normalizeRelative(path.join(dir, `v${from}.json`));
  const newRel = normalizeRelative(path.join(dir, `v${to}.json`));
  const oldAbs = path.join(repoRoot, oldRel);
  if (!fs.existsSync(oldAbs)) {
    throw new Error(`manifest catalog file not found: ${oldRel}`);
  }
  // Stage the rename via `git mv` so the diff stays attributable as a rename.
  execSync(`git mv "${oldRel}" "${newRel}"`, { cwd: repoRoot });
  const newAbs = path.join(repoRoot, newRel);
  const body = readJson(newAbs);
  body.version = to;
  writeJsonPreservingTrailingNewline(newAbs, body);
}

function sweepHardcodedLiteral(repoRoot, relPath, from, to) {
  const abs = path.join(repoRoot, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`hardcoded-literal file not found: ${relPath}`);
  }
  const before = fs.readFileSync(abs, 'utf8');
  // Bare string replace — these are version literals embedded in JS source,
  // no regex anchoring required.
  const after = before.split(from).join(to);
  if (after !== before) {
    fs.writeFileSync(abs, after);
  }
}

function buildInventorySet() {
  const inventory = new Set();
  for (const p of WRAPPER_JSON_FILES) inventory.add(normalizeRelative(p));
  for (const p of PLUGIN_JSON_FILES) inventory.add(normalizeRelative(p));
  for (const p of HARDCODED_LITERAL_FILES) inventory.add(normalizeRelative(p));
  return inventory;
}

function manifestPathsAfterBump(to) {
  // After bump, only the v<to>.json files should remain — these are still part
  // of the carrier inventory and will (correctly) match the post-bump `git grep`.
  const out = new Set();
  for (const dir of MANIFEST_DIRS) {
    out.add(normalizeRelative(path.join(dir, `v${to}.json`)));
  }
  return out;
}

function strayCarrierGuard(repoRoot, from, to) {
  let raw;
  try {
    // `git grep -l` exits non-zero with no output when nothing matches.
    raw = execSync(`git grep -l "${from}"`, { cwd: repoRoot, encoding: 'utf8' });
  } catch (err) {
    if (err.status === 1 && !err.stdout) return; // no matches — clean.
    throw err;
  }
  const matches = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeRelative);

  const inventory = buildInventorySet();
  const manifestSurvivors = manifestPathsAfterBump(to);

  for (const match of matches) {
    if (inventory.has(match)) continue;
    if (manifestSurvivors.has(match)) continue;
    if (GUARD_EXCLUDED_FILES.has(match)) continue;
    throw new Error(`unknown carrier: ${match}`);
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function bumpVersion({ from, to, repoRoot }) {
  if (!from || !to) {
    throw new Error('bumpVersion requires { from, to, repoRoot }');
  }
  if (!repoRoot) {
    throw new Error('bumpVersion requires repoRoot');
  }
  if (from === to) {
    throw new Error(`bumpVersion: from and to are equal ("${from}")`);
  }

  // 1. Wrapper package.json files.
  for (const rel of WRAPPER_JSON_FILES) {
    bumpJsonFile(repoRoot, rel, from, to, 'wrapper');
  }

  // 2. Plugin authoritative version sources.
  for (const rel of PLUGIN_JSON_FILES) {
    bumpJsonFile(repoRoot, rel, from, to, 'plugin authoritative source');
  }

  // 3. Per-version manifest catalog files — `git mv` rename + internal bump.
  for (const dir of MANIFEST_DIRS) {
    bumpManifestCatalogFile(repoRoot, dir, from, to);
  }

  // 4. Hardcoded-literal sweep.
  for (const rel of HARDCODED_LITERAL_FILES) {
    sweepHardcodedLiteral(repoRoot, rel, from, to);
  }

  // 5. Stray-carrier guard.
  strayCarrierGuard(repoRoot, from, to);
}

// -----------------------------------------------------------------------------
// CLI entry point — `node bump-version.mjs --from <prev> --to <next>`
// -----------------------------------------------------------------------------

function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--repo-root') out.repoRoot = argv[++i];
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { from, to, repoRoot } = parseArgv(process.argv.slice(2));
  bumpVersion({
    from,
    to,
    repoRoot: repoRoot || process.cwd(),
  }).then(
    () => {
      console.log(`bumped ${from} -> ${to}`);
    },
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
