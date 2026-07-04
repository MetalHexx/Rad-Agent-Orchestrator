import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { validatePluginTree, REQUIRED_ARTIFACTS } from '../build-scripts/validate.js';

function makeMinimalOutput(version) {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'val-'));
  const out = join(root, 'output');
  const inst = join(root, 'installer');
  fs.mkdirSync(join(inst, 'manifests'), { recursive: true });
  fs.mkdirSync(join(out, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(join(out, '.claude-plugin/plugin.json'), JSON.stringify({ version }));
  fs.writeFileSync(join(inst, 'manifests', `v${version}.json`), JSON.stringify({ version, files: [] }));
  fs.mkdirSync(join(out, 'agents'), { recursive: true });
  // canonical: coder
  const canonical = join(root, 'harness-files/agents');
  fs.mkdirSync(canonical, { recursive: true });
  fs.writeFileSync(join(canonical, 'coder.md'), 'x');
  fs.writeFileSync(join(out, 'agents/coder.md'), 'x');
  fs.mkdirSync(join(out, 'skills/rad-orchestration/scripts'), { recursive: true });
  fs.writeFileSync(join(out, 'skills/rad-orchestration/scripts/radorch.mjs'), '#!/usr/bin/env node\n');
  fs.writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'x', version, files: ['.claude-plugin/', 'agents/', 'skills/', 'manifests/'] }));
  fs.mkdirSync(join(out, 'manifests'), { recursive: true });
  fs.writeFileSync(join(out, 'manifests', `v${version}.json`), JSON.stringify({ version, files: [] }));
  fs.mkdirSync(join(out, 'hooks'), { recursive: true });
  fs.writeFileSync(join(out, 'hooks/hooks.json'), '{}');
  fs.writeFileSync(join(out, 'hooks/bootstrap.mjs'), '// b\n');
  fs.writeFileSync(join(out, 'hooks/drift-check.mjs'), '// d\n');
  return { root, out, inst, canonicalAgentsDir: canonical };
}

test('REQUIRED_ARTIFACTS no longer includes the retired pipeline bundle or explode-master-plan bundle', () => {
  assert.ok(!REQUIRED_ARTIFACTS.includes('skills/rad-orchestration/scripts/pipeline.js'),
    'validator allow-list must not require the retired pipeline bundle');
  assert.ok(!REQUIRED_ARTIFACTS.includes('skills/rad-orchestration/scripts/explode-master-plan.js'),
    'validator allow-list must not require the retired explode-master-plan script');
});

test('gate 1: missing required artifact aborts', () => {
  const { out, inst, canonicalAgentsDir } = makeMinimalOutput('1.0.0');
  fs.rmSync(join(out, 'skills/rad-orchestration/scripts/radorch.mjs'));
  assert.throws(
    () => validatePluginTree({ outputDir: out, canonicalAgentsDir }),
    /radorch\.mjs/,
  );
});

test('gate 2: missing agent file aborts', () => {
  const { out, inst, canonicalAgentsDir } = makeMinimalOutput('1.0.0');
  fs.rmSync(join(out, 'agents/coder.md'));
  assert.throws(() => validatePluginTree({ outputDir: out, canonicalAgentsDir }), /agents\/coder\.md/);
});

test('gate 4: missing per-version manifest aborts', () => {
  const { out, inst, canonicalAgentsDir } = makeMinimalOutput('1.0.0');
  fs.rmSync(join(out, 'manifests/v1.0.0.json'));
  assert.throws(() => validatePluginTree({ outputDir: out, canonicalAgentsDir }), /manifests\/v1\.0\.0\.json/);
});

test('gate 5: tarball size budget enforced via npm pack --dry-run --json', () => {
  // The validator must report the unpacked size and abort over 50MB×1.1.
  // Drive via a faked sizer parameter so tests don't depend on a real npm.
  const { out, inst, canonicalAgentsDir } = makeMinimalOutput('1.0.0');
  const oversized = () => ({ unpackedSize: 60 * 1024 * 1024 });
  assert.throws(
    () => validatePluginTree({ outputDir: out, installerDir: inst, canonicalAgentsDir, sizer: oversized }),
    /size budget|55 MB|exceeds/i,
  );
});

test('happy path — every gate passes on a complete payload', () => {
  const { out, inst, canonicalAgentsDir } = makeMinimalOutput('1.0.0');
  const undersize = () => ({ unpackedSize: 1024 });
  assert.doesNotThrow(() => validatePluginTree({ outputDir: out, installerDir: inst, canonicalAgentsDir, sizer: undersize }));
});
