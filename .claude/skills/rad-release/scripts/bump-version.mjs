#!/usr/bin/env node
// Lockstep version-bump engine.
//
// Bumps a single carrier inventory in one atomic pass:
//   1. Wrapper `package.json` files — in-place JSON edit (version + intra-repo pins)
//   2. Plugin authoritative version sources — in-place JSON edit
//   3. Per-plugin manifest catalog files — `git mv`-rename + internal version bump
//   4. Hardcoded-literal files — bare string replacement
//   5. Nested per-workspace lockfiles — deterministic two-field version rewrite
//   6. Stray-carrier guard — `git grep -l <from>` and fail loudly on any unlisted carrier
//
// Manifest catalog files split into two behaviorally distinct groups
// (`PLUGIN_MANIFEST_DIRS` vs `STANDARD_MANIFEST_DIRS`), because the two
// installers' `catalog.js` implementations have different upgrade contracts:
//
//   - `PLUGIN_MANIFEST_DIRS` (the three `<plugin>/manifests/` dirs): each
//     holds a single HAND-AUTHORED manifest for whatever version is currently
//     in-tree (kept in sync with the plugin's `_install-source/` tree by
//     `manifest-payload-parity.test.mjs`, not machine-generated). The
//     per-plugin `catalog.js` has no prior-version lookup, so this file is
//     renamed forward at every release: `v<from>.json` -> `v<to>.json` with
//     its internal `version` field updated. Exactly one file exists at a time.
//
//   - `STANDARD_MANIFEST_DIRS` (`harness-installers/standard/manifests/*`):
//     `harness-installers/standard/lib/install/catalog.js`'s upgrade path
//     requires every prior version's manifest to remain bundled (AD-4) so
//     upgraders can resolve whatever version they're currently on. These are
//     deliberately NOT touched by this engine — the build step (build.js /
//     emit-manifest.js) adds the new version's manifest fresh, alongside
//     every manifest already checked into the repo, rather than replacing it.
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

// 1. Wrapper package.json files (18) — JSON, in-place `version` bump. Any
// intra-repo `@rad-orchestration/*` dependency pin equal to `from` is rewritten
// to `to` in the same pass (see `bumpJsonFile`) so workspace resolution stays intact.
export const WRAPPER_JSON_FILES = [
  'cli/package.json',
  'ui/package.json',
  'lib/repo-registry/package.json',
  'lib/telemetry/package.json',
  'lib/work-graph/package.json',
  'harness-adapters/engine/package.json',
  'harness-installers/standard/package.json',
  'harness-installers/shared/build-helpers/package.json',
  'harness-installers/claude-plugin/package.json',
  'harness-installers/copilot-cli-plugin/package.json',
  'harness-installers/copilot-vscode-plugin/package.json',
  // Graph subsystem — real deliverables, released in lockstep like everything else.
  'graph-service/package.json',
  'lib/graph-client/package.json',
  'lib/graph-engine/package.json',
  'lib/graph-node-types/package.json',
  'lib/graph-store-sqlite/package.json',
  'examples/example/package.json',
  'examples/node-blind-fixture/package.json',
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

// 3a. Per-plugin manifest catalog directories (3) — each holds exactly one
// hand-authored `v<version>.json` for the in-tree version; `git mv`-renamed +
// internal `version` field bumped on every release (see file header).
export const PLUGIN_MANIFEST_DIRS = [
  'harness-installers/claude-plugin/manifests',
  'harness-installers/copilot-cli-plugin/manifests',
  'harness-installers/copilot-vscode-plugin/manifests',
];

// 3b. Standard-installer per-harness manifest catalog directories (3) — AD-4
// accumulation; never touched by this engine (see file header).
export const STANDARD_MANIFEST_DIRS = [
  'harness-installers/standard/manifests/claude',
  'harness-installers/standard/manifests/copilot-cli',
  'harness-installers/standard/manifests/copilot-vscode',
];

// Combined, for the stray-carrier guard's historical-file allowance.
export const MANIFEST_DIRS = [...PLUGIN_MANIFEST_DIRS, ...STANDARD_MANIFEST_DIRS];

// 4. Hardcoded-literal files (22) — bare `from` string replaced everywhere.
// These embed the version as a literal (manifest filenames like
// `v<version>.json`, or `version: '<version>'` assertions in tests / build
// helpers) rather than reading it from a package.json. NOTE: never write a
// concrete version literal in this engine's own source (comments included) —
// the guard greps every tracked file, so a literal here would flag this file
// as an unknown carrier after a real bump.
export const HARDCODED_LITERAL_FILES = [
  'harness-installers/claude-plugin/build-scripts/parity-check.js',
  'harness-installers/claude-plugin/tests/manifest-shape.test.mjs',
  'harness-installers/claude-plugin/tests/helpers/install-bench.js',
  'harness-installers/copilot-cli-plugin/tests/build-payload.test.mjs',
  'harness-installers/copilot-cli-plugin/tests/helpers/install-bench.js',
  'harness-installers/copilot-cli-plugin/tests/helpers/run-build.js',
  'harness-installers/copilot-vscode-plugin/tests/build-payload.test.mjs',
  'harness-installers/copilot-vscode-plugin/tests/helpers/install-bench.js',
  'harness-installers/copilot-vscode-plugin/tests/helpers/run-build.js',
  'harness-installers/standard/tests/build/action-events-bundling.test.mjs',
  'harness-installers/standard/tests/build/build.test.mjs',
  'harness-installers/standard/tests/build/emit-manifest.test.mjs',
  'harness-installers/standard/tests/build/standard-manifest-no-parallel.test.mjs',
  'harness-installers/standard/tests/build/validate.test.mjs',
  'harness-installers/standard/tests/helpers/run-build.js',
  'harness-installers/standard/tests/install/hook-wiring.test.mjs',
  'harness-installers/standard/tests/install/uninstall-harness.test.mjs',
  'harness-installers/standard/tests/integration/build-then-install.test.mjs',
  'harness-installers/standard/tests/lib/drift-hint.test.mjs',
  'harness-installers/standard/tests/lib/wizard.test.mjs',
  'cli/tests/behavioral/manifest-integrity/explode-master-plan-restored.test.ts',
  'lib/graph-node-types/tests/dependency-direction.test.ts',
];

// 5. Nested per-workspace lockfiles (3) — committed `package-lock.json` files
// that live under an individually-packed workspace (cli / ui / the harness
// adapter engine). The repo-root lockfile is git-ignored; these three are
// tracked and carry the workspace version in exactly two fields: top-level
// `version` and `packages[""].version`. A version-only bump never changes their
// resolved dependency tree (intra-repo deps resolve through the workspace
// parent and are not enumerated here), so both fields are rewritten
// deterministically rather than regenerated via `npm install`.
export const LOCKFILE_JSON_FILES = [
  'cli/package-lock.json',
  'ui/package-lock.json',
  'harness-adapters/engine/package-lock.json',
];

// Carriers intentionally excluded from the stray-carrier guard — files that
// legitimately hold the prior version but must NOT be swept by this engine:
//   - Auto-stamped / legacy-comment: `runtime-config/orchestration.yml` is
//     regenerated downstream; `CHANGELOG.md` legacy comments preserve history.
//   - Graph-subsystem sandbox fixture (`prompt-tests/_handoff-sandbox/**`): an
//     illustrative copy used by prompt-tests, not a real deliverable. Frozen at
//     its own version, independent of the now-lockstepped graph-service,
//     lib/graph-*, and examples/ packages.
//   - Test / doc fixtures that reference a version literal incidentally (e.g.
//     `dev-bump.test.mjs` mentions a nearby alpha-counter literal that the
//     unanchored grep matches as a false positive) and are not release carriers.
// Nested per-workspace lockfiles are NOT excluded — they get a dedicated bump
// pass (see `LOCKFILE_JSON_FILES` / `bumpLockfileVersionFields`) so a lingering
// prior version in one still trips the guard and fails loud.
const GUARD_EXCLUDED_FILES = new Set([
  'runtime-config/orchestration.yml',
  'CHANGELOG.md',
  // Graph-subsystem sandbox fixture — frozen, independent of the real packages.
  'prompt-tests/_handoff-sandbox/graph-service/package.json',
  'prompt-tests/_handoff-sandbox/lib/graph-engine/package.json',
  'prompt-tests/_handoff-sandbox/lib/graph-node-types/package.json',
  'prompt-tests/_handoff-sandbox/lib/graph-store-sqlite/package.json',
  // Test / doc fixtures that reference a version literal incidentally.
  'docs/internals/_private/INSTALL-REFACTOR-DESIGN.md',
  'cli/tests/lib/install-json.test.ts',
  'cli/tests/commands/doctor.test.ts',
  'cli/tests/lib/cross-harness-scan.test.ts',
  '.claude/skills/rad-release/tests/bump-version.test.mjs',
  '.claude/skills/rad-release/tests/dev-bump.test.mjs',
  '.claude/skills/rad-release/tests/changelog-and-commit.test.mjs',
  '.claude/skills/rad-release/tests/sync-satellite-and-tag.test.mjs',
  // Illustrative version-literal example in the workflow_dispatch input description.
  '.github/workflows/npm-dist-tag.yml',
  // Illustrative version-literal example in prose (step 10 docs), not a carrier.
  '.claude/skills/rad-release/SKILL.md',
  // Illustrative version-literal examples in comments only; version is derived
  // dynamically from `github.ref_name` at CI runtime, not a literal carrier.
  '.github/workflows/publish.yml',
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

// Rewrite any intra-repo `@rad-orchestration/*` dependency whose pin is exactly
// `from` to `to`, across dependencies / devDependencies / peerDependencies.
// These workspace libs are published only inside the monorepo, so their pins
// must move in lockstep with the version bump or `npm install` breaks. Returns
// the count of pins rewritten (for diagnostics).
function rewriteIntraRepoPins(json, from, to) {
  let rewritten = 0;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = json[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (name.startsWith('@rad-orchestration/') && spec === from) {
        deps[name] = to;
        rewritten += 1;
      }
    }
  }
  return rewritten;
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
  rewriteIntraRepoPins(json, from, to);
  writeJsonPreservingTrailingNewline(abs, json);
}

// Rewrite the two version fields a committed nested lockfile carries — its
// top-level `version` and its self entry `packages[""].version`. Deterministic:
// no `npm install`, so it works offline and never perturbs the resolved tree.
function bumpLockfileVersionFields(repoRoot, relPath, from, to) {
  const abs = path.join(repoRoot, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`lockfile not found: ${relPath}`);
  }
  const lock = readJson(abs);
  if (lock.version !== from) {
    throw new Error(
      `lockfile ${relPath} has version "${lock.version}", expected "${from}"`,
    );
  }
  lock.version = to;
  if (lock.packages && lock.packages[''] && lock.packages[''].version === from) {
    lock.packages[''].version = to;
  }
  writeJsonPreservingTrailingNewline(abs, lock);
}

// Renames a plugin's single hand-authored manifest forward: `v<from>.json` ->
// `v<to>.json` via `git mv`, then updates its internal `version` field. Unlike
// the standard installer's AD-4 catalog, exactly one file is expected to
// exist per plugin manifest dir at any time (see file header).
function bumpManifestCatalogFile(repoRoot, dir, from, to) {
  const fromRel = normalizeRelative(path.join(dir, `v${from}.json`));
  const toRel = normalizeRelative(path.join(dir, `v${to}.json`));
  const fromAbs = path.join(repoRoot, fromRel);
  if (!fs.existsSync(fromAbs)) {
    throw new Error(`manifest catalog file not found: ${fromRel}`);
  }
  execSync(`git mv "${fromRel}" "${toRel}"`, { cwd: repoRoot });
  const toAbs = path.join(repoRoot, toRel);
  const body = readJson(toAbs);
  if (body.version !== from) {
    throw new Error(`manifest catalog ${toRel} has version "${body.version}", expected "${from}"`);
  }
  body.version = to;
  writeJsonPreservingTrailingNewline(toAbs, body);
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

// Standard-installer manifest catalog files accumulate forever (AD-4) — a
// match under any STANDARD_MANIFEST_DIRS entry is always an expected
// historical carrier, whether it's the version just bumped from, the version
// just bumped to (emitted by the build step, not this engine), or any earlier
// shipped version still on disk. Plugin manifest dirs are NOT exempted here:
// `bumpManifestCatalogFile` renames their single file forward in this same
// pass, so a lingering `from`-versioned file after that step is a real bug
// the guard should catch.
function isManifestCatalogFile(match) {
  for (const dir of STANDARD_MANIFEST_DIRS) {
    const prefix = normalizeRelative(dir) + '/';
    if (match.startsWith(prefix) && /^v.+\.json$/.test(match.slice(prefix.length))) {
      return true;
    }
  }
  return false;
}

function strayCarrierGuard(repoRoot, from) {
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

  for (const match of matches) {
    if (inventory.has(match)) continue;
    if (isManifestCatalogFile(match)) continue;
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

  // 3. Per-plugin manifest catalog files — rename forward (see file header).
  for (const dir of PLUGIN_MANIFEST_DIRS) {
    bumpManifestCatalogFile(repoRoot, dir, from, to);
  }

  // 4. Hardcoded-literal sweep.
  for (const rel of HARDCODED_LITERAL_FILES) {
    sweepHardcodedLiteral(repoRoot, rel, from, to);
  }

  // 5. Nested per-workspace lockfile version fields.
  for (const rel of LOCKFILE_JSON_FILES) {
    bumpLockfileVersionFields(repoRoot, rel, from, to);
  }

  // 6. Stray-carrier guard. Standard-installer manifest catalog files
  // (STANDARD_MANIFEST_DIRS) are intentionally left untouched above — see
  // file header — so the guard permits any historical one still carrying
  // `from` as version content. Plugin manifest files were already renamed
  // forward in step 3, so no exemption applies to them here.
  strayCarrierGuard(repoRoot, from);
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
