import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitHookBundle } from '../emit-hook-bundle.js';

test('emitHookBundle stages telemetry-capture.mjs from sharedHooksDir (FR-10, AD-8)', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-'));
  const source = path.join(work, 'plugin-hooks'); fs.mkdirSync(source, { recursive: true });
  const shared = path.join(work, 'shared-hooks'); fs.mkdirSync(shared, { recursive: true });
  // Minimal source tree the bundler needs.
  fs.writeFileSync(path.join(source, 'bootstrap.mjs'), 'export default 1;\n');
  fs.writeFileSync(path.join(source, 'hooks.json'), '{"hooks":{}}');
  fs.writeFileSync(path.join(shared, 'session-preamble.mjs'), '// preamble\n');
  fs.writeFileSync(path.join(shared, 'telemetry-capture.mjs'), '// telemetry\n');
  const target = path.join(work, 'out-hooks');
  await emitHookBundle({ source, target, sharedHooksDir: shared });
  assert.ok(fs.existsSync(path.join(target, 'telemetry-capture.mjs')), 'shim staged');
});

test('shim actually runs under the plugin node -e wrapper — guards F-1 (NFR-6, FR-9)', () => {
  // Under `node -e "import(...shim)"` process.argv[1] is undefined; the entry guard must still
  // run main(). Prove it: gate ON + a fake radorch that writes a sentinel when spawned.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-home-'));
  fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
  fs.writeFileSync(path.join(home, '.radorc', 'orchestration.yml'), 'telemetry:\n  enabled: true\n');
  const scriptsDir = path.join(home, 'plugin', 'skills', 'rad-orchestration', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const sentinel = path.join(home, 'ran.txt');
  fs.writeFileSync(path.join(scriptsDir, 'radorch.mjs'),
    `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(sentinel)}, 'ran');`);
  const shim = path.resolve('harness-installers/shared/hooks/telemetry-capture.mjs').replace(/\\/g, '/');
  const code = `import('node:url').then(u=>import(u.pathToFileURL('${shim}').href))`;
  const res = spawnSync(process.execPath, ['-e', code], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }),
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: path.join(home, 'plugin') },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, 'wrapper-invoked shim exits 0');
  assert.ok(fs.existsSync(sentinel), 'main() ran under node -e and reached capture');
});

test('stages session-preamble.mjs from sharedHooksDir, not the plugin source tree (AD-8)', async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-src-'));
  const sharedHooksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-shared-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-out-'));
  fs.writeFileSync(path.join(source, 'bootstrap.mjs'), '#!/usr/bin/env node\nprocess.exit(0);\n');
  // The plugin `source` tree intentionally does NOT carry session-preamble.mjs.
  const sharedContents = '#!/usr/bin/env node\n// canonical shared shim\nexport function buildHookOutput(){return{additionalContext:""}}\n';
  fs.writeFileSync(path.join(sharedHooksDir, 'session-preamble.mjs'), sharedContents);
  await emitHookBundle({ source, target, sharedHooksDir });
  const staged = path.join(target, 'session-preamble.mjs');
  assert.ok(fs.existsSync(staged), 'session-preamble.mjs staged into output');
  assert.strictEqual(fs.readFileSync(staged, 'utf8'), sharedContents,
    'staged shim matches the sharedHooksDir copy, proving it came from the shared location');
});
