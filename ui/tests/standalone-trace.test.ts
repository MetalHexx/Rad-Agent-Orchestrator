// Opt-in gate: these tests run a full Next.js standalone build plus a lib build,
// which is slow and not appropriate for every normal test run. Set
// RADORCH_STANDALONE_TRACE=1 to enable them (e.g. for release validation or
// on-demand DD-1 trace assertion verification). Without the gate all three tests
// are reported as SKIPPED so the normal test suite stays fast and reliable.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, type ExecSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TRACE_GATE = process.env.RADORCH_STANDALONE_TRACE === '1';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(uiRoot, '..');
const standalone = path.join(uiRoot, '.next/standalone');

function findFirst(...candidates: string[]): string | null {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

before(() => {
  if (!TRACE_GATE) return;
  execSync('npm run build -w @rad-orchestration/repo-registry', { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' } as unknown as ExecSyncOptions);
  execSync('npm run build -w @rad-orchestration/telemetry', { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' } as unknown as ExecSyncOptions);
  execSync('npm run build-standalone', { cwd: uiRoot, stdio: 'inherit', shell: process.platform === 'win32' } as unknown as ExecSyncOptions);
});

test('standalone ships the lib dist index plus a sibling dist module', { skip: TRACE_GATE ? false : 'set RADORCH_STANDALONE_TRACE=1 to run the standalone trace gate' }, () => {
  const idx = findFirst(
    path.join(standalone, 'lib/repo-registry/dist/index.js'),
    path.join(standalone, 'node_modules/@rad-orchestration/repo-registry/dist/index.js'),
  );
  assert.ok(idx, 'lib dist/index.js not traced into standalone');
  const distDir = path.dirname(idx);
  assert.ok(fs.existsSync(path.join(distDir, 'io.js')), 'sibling dist module not traced');
});

test('standalone ships the lib package.json so exports resolve', { skip: TRACE_GATE ? false : 'set RADORCH_STANDALONE_TRACE=1 to run the standalone trace gate' }, () => {
  const pkg = findFirst(
    path.join(standalone, 'lib/repo-registry/package.json'),
    path.join(standalone, 'node_modules/@rad-orchestration/repo-registry/package.json'),
  );
  assert.ok(pkg, 'lib package.json not traced into standalone');
});

test('standalone ships a reachable js-yaml (the make-or-break check)', { skip: TRACE_GATE ? false : 'set RADORCH_STANDALONE_TRACE=1 to run the standalone trace gate' }, () => {
  let found = false;
  const stack = [standalone];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (!e.isDirectory()) continue;
      if (e.name === 'js-yaml' && fs.existsSync(path.join(abs, 'lib')) && fs.existsSync(path.join(abs, 'package.json'))) {
        found = true; break;
      }
      stack.push(abs);
    }
    if (found) break;
  }
  assert.ok(found, 'js-yaml lib + package.json not reachable in standalone — route would throw at runtime');
});

test('standalone ships the telemetry lib dist + package.json (AD-1)', { skip: TRACE_GATE ? false : 'set RADORCH_STANDALONE_TRACE=1 to run the standalone trace gate' }, () => {
  const idx = findFirst(
    path.join(standalone, 'lib/telemetry/dist/index.js'),
    path.join(standalone, 'node_modules/@rad-orchestration/telemetry/dist/index.js'),
  );
  assert.ok(idx, 'telemetry dist/index.js not traced into standalone');
  assert.ok(findFirst(path.join(standalone, 'lib/telemetry/package.json')), 'telemetry package.json not traced');
});
