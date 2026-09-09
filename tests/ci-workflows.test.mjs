import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const cli = fs.readFileSync(path.join(repoRoot, '.github/workflows/cli.yml'), 'utf8');

test('ci.yml runs root workspace guard tests', () => {
  // The .mjs glob alone would silently skip the TypeScript guards, so the command
  // form itself is what this asserts: tsx loaded, and both globs passed.
  assert.match(ci, /node --test --import tsx "tests\/\*\.test\.mjs" "tests\/\*\.test\.ts"/,
    'ci.yml must run the root guards with tsx over both tests/*.test.mjs and tests/*.test.ts');
});

test('ci.yml builds and tests the library', () => {
  assert.match(ci, /repo-registry/);
  assert.match(ci, /npm run build -w @rad-orchestration\/repo-registry/);
  assert.match(ci, /(vitest run|npm test -w @rad-orchestration\/repo-registry)/);
});

test('ci.yml repo-registry root-workspace install uses npm install (not npm ci)', () => {
  // Scope the check to the root-workspace install step: the root lockfile is
  // intentionally gitignored, so that step must use `npm install`. Other jobs
  // may legitimately use `npm ci` with committed subpackage lockfiles, so we do
  // not forbid `npm ci` across the whole workflow file.
  assert.match(ci, /Install dependencies \(root workspace\)\s*\n\s*run: npm install/,
    'ci.yml root-workspace install step must use npm install');
});

test('cli.yml watches lib/repo-registry and uses a root install', () => {
  assert.match(cli, /lib\/repo-registry\/\*\*/);
  assert.ok(!/Install repo-registry deps/.test(cli), 'stale lib-deps install step still present');
});

test('cli.yml cli root-workspace install uses npm install (not npm ci)', () => {
  // Scoped to the root-workspace install step (see ci.yml test above for rationale).
  assert.match(cli, /Install dependencies \(root workspace\)\s*\n\s*run: npm install/,
    'cli.yml root-workspace install step must use npm install');
});
