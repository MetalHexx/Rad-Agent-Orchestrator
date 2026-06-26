import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitHookBundle } from '../../shared/build-helpers/emit-hook-bundle.js';

// Resolve paths relative to this test file, not process.cwd(), so the suite
// passes under `npm test -w <workspace>` (cwd = workspace dir) as well as a
// repo-root `node --test` invocation.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '../..');
const SRC = path.join(PLUGIN_ROOT, 'hooks/hooks.json');
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('build emits output hooks.json verbatim from source (FR-9, AD-9)', async () => {
  // output/ is build-generated and gitignored; build into a throwaway target and
  // assert the emitted hooks.json equals the committed source — no reliance on a
  // pre-existing on-disk artifact.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-hooks-out-'));
  try {
    await emitHookBundle({
      source: path.join(PLUGIN_ROOT, 'hooks'),
      target,
      sharedHooksDir: path.join(REPO_ROOT, 'harness-installers/shared/hooks'),
    });
    assert.deepEqual(load(path.join(target, 'hooks.json')), load(SRC));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('source registers the 3 telemetry events at telemetry-capture.mjs (FR-9)', () => {
  const s = load(SRC);
  // AD-7 reversal: PostToolUse fires on all tools now (no matcher), in parity with
  // the standard installer; capture is non-blocking (CLI detaches a worker).
  assert.equal(s.hooks.PostToolUse[0].matcher, undefined);
  const cmds = [...s.hooks.PostToolUse, ...s.hooks.Stop, ...s.hooks.SessionEnd]
    .map((e) => e.hooks[0].command);
  assert.equal(cmds.filter((c) => c.includes('telemetry-capture.mjs')).length, 3);
});
