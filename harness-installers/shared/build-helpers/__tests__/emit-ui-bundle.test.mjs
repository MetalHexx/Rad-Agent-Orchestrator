import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { emitUiBundle } from '../emit-ui-bundle.js';

// Driven via a synthetic build runner injected as a parameter — we don't
// execute real Next.js inside unit tests. The helper's responsibility under
// test is the orchestration: invoke the build runner, stage standalone+static+public,
// pack into a single tarball at `target`, then clean up source `.next/`. Real
// Next.js invocation is exercised by P05's build-payload smoke test.
test('emitUiBundle packs standalone, static, public into a tarball and removes .next after build', async () => {
  const tmpRoot = fs.mkdtempSync(join(os.tmpdir(), 'emit-ui-'));
  try {
    const ui = join(tmpRoot, 'ui');
    fs.mkdirSync(ui, { recursive: true });
    // Synthetic .next/ tree that the fake runner pretends to populate, plus
    // a node_modules/ subtree inside standalone/ to mimic Next's standalone
    // bundle output (the loss of this dir at publish is the bug this fix addresses).
    // With outputFileTracingRoot = repo root, Next emits the app under
    // standalone/ui/ (the app directory path relative to the repo root).
    const runner = async () => {
      fs.mkdirSync(join(ui, '.next/standalone/ui'), { recursive: true });
      fs.writeFileSync(join(ui, '.next/standalone/ui/server.js'), '// server\n');
      fs.mkdirSync(join(ui, '.next/standalone/node_modules/next'), { recursive: true });
      fs.writeFileSync(join(ui, '.next/standalone/node_modules/next/package.json'), '{"name":"next"}');
      fs.mkdirSync(join(ui, '.next/static/chunks'), { recursive: true });
      fs.writeFileSync(join(ui, '.next/static/chunks/main.js'), '// main\n');
      fs.mkdirSync(join(ui, 'public'), { recursive: true });
      fs.writeFileSync(join(ui, 'public/logo.svg'), '<svg/>');
    };
    const target = join(tmpRoot, 'out', 'ui.tgz');
    await emitUiBundle({ source: ui, target, runner });

    assert.ok(fs.existsSync(target), 'tarball file emitted at target');
    assert.ok(!fs.existsSync(join(tmpRoot, 'out', 'ui.tgz.staging')), 'staging dir cleaned up');
    assert.ok(!fs.existsSync(join(ui, '.next')), '.next/ removed after build');

    // Roundtrip: extract the tarball into a tmpdir and verify every staged
    // file survives — especially node_modules/, the file class that git and
    // npm-packlist would have stripped in a loose tree.
    const extracted = join(tmpRoot, 'extracted');
    fs.mkdirSync(extracted, { recursive: true });
    await tar.x({ file: target, cwd: extracted });
    assert.ok(fs.existsSync(join(extracted, 'ui/server.js')), 'standalone ui/server.js roundtripped');
    assert.ok(fs.existsSync(join(extracted, 'node_modules/next/package.json')), 'node_modules/ roundtripped');
    assert.ok(fs.existsSync(join(extracted, 'ui/.next/static/chunks/main.js')), 'ui/.next/static roundtripped');
    assert.ok(fs.existsSync(join(extracted, 'public/logo.svg')), 'public/ roundtripped');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
