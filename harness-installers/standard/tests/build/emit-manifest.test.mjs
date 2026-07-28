import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitManifest } from '../../build-scripts/emit-manifest.js';

test('emitManifest produces { version, channel, files[] } with bundlePath and destinationPath, omits user-data assets', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'std-mf-'));
  try {
    // Synthetic output/<harness>/ tree.
    const harnessOut = path.join(tmp, 'output/claude');
    fs.mkdirSync(path.join(harnessOut, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(harnessOut, 'skills/rad-orchestration/scripts'), { recursive: true });
    fs.mkdirSync(path.join(harnessOut, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(harnessOut, 'agents/coder.md'), 'coder');
    fs.writeFileSync(path.join(harnessOut, 'skills/rad-orchestration/scripts/radorch.mjs'), '#!/usr/bin/env node\n');
    fs.writeFileSync(path.join(harnessOut, 'templates/extra-high.yml'), 'x');
    fs.writeFileSync(path.join(harnessOut, 'orchestration.yml'), 'x');
    const manifestDir = path.join(tmp, 'manifests/claude');
    fs.mkdirSync(manifestDir, { recursive: true });
    await emitManifest({ harnessOutputDir: harnessOut, harness: 'claude', version: '1.0.0-alpha.10', manifestDir });
    const written = JSON.parse(fs.readFileSync(path.join(manifestDir, 'v1.0.0-alpha.10.json'), 'utf8'));
    assert.strictEqual(written.version, '1.0.0-alpha.10');
    assert.strictEqual(written.channel, 'standard');
    const paths = written.files.map((f) => f.bundlePath).sort();
    // Per-harness installable tree only — no orchestration.yml, no templates/, no ui/.
    assert.ok(paths.includes('agents/coder.md'));
    assert.ok(paths.includes('skills/rad-orchestration/scripts/radorch.mjs'));
    assert.ok(!paths.includes('skills/rad-orchestration/scripts/pipeline.js'), 'manifest does not list retired pipeline bundle');
    assert.ok(!paths.includes('orchestration.yml'), 'AD-3: user-data assets not in manifest');
    assert.ok(!paths.some((p) => p.startsWith('templates/')), 'AD-3: templates not in manifest');
    // destinationPath uses ${HARNESS_ROOT} (per-harness install root) for installable tree.
    const coder = written.files.find((f) => f.bundlePath === 'agents/coder.md');
    assert.strictEqual(coder.destinationPath, '${HARNESS_ROOT}/agents/coder.md');
    // sha-free path catalog — no per-file hash field (entries are { bundlePath, destinationPath }).
    for (const f of written.files) assert.strictEqual(f.sha256, undefined);
    // No `ownership` field anywhere (AD-3).
    for (const f of written.files) assert.strictEqual(f.ownership, undefined);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
