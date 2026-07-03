import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { validatePluginTree, REQUIRED_ARTIFACTS } from '../build-scripts/validate.js';

function makeValidOutput(version) {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'val-vsc-'));
  fs.mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'rad-orc-vscode', version }));
  fs.writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@rad-orchestration/copilot-vscode-plugin', version }));
  fs.mkdirSync(join(root, 'skills/rad-orchestration/scripts'), { recursive: true });
  fs.writeFileSync(join(root, 'skills/rad-orchestration/scripts/radorch.mjs'), '#!/usr/bin/env node\n');
  fs.mkdirSync(join(root, 'hooks'), { recursive: true });
  fs.writeFileSync(join(root, 'hooks/hooks.json'), '{}');
  fs.writeFileSync(join(root, 'hooks/bootstrap.mjs'), '// boot\n');
  fs.writeFileSync(join(root, 'hooks/drift-check.mjs'), '// drift\n');
  fs.mkdirSync(join(root, 'agents'), { recursive: true });
  fs.writeFileSync(join(root, 'agents/reviewer.agent.md'), '# reviewer\n');
  fs.writeFileSync(join(root, 'agents/coder.agent.md'), '# coder\n');
  fs.mkdirSync(join(root, 'manifests'), { recursive: true });
  fs.writeFileSync(join(root, `manifests/v${version}.json`), JSON.stringify({ version, channel: 'copilot-vscode-plugin', files: [] }));

  const canonicalDir = fs.mkdtempSync(join(os.tmpdir(), 'canon-'));
  fs.writeFileSync(join(canonicalDir, 'reviewer.md'), '# reviewer');
  fs.writeFileSync(join(canonicalDir, 'coder.md'), '# coder');
  return { root, canonicalDir };
}

test('REQUIRED_ARTIFACTS no longer includes the retired pipeline bundle or explode-master-plan bundle', () => {
  assert.ok(!REQUIRED_ARTIFACTS.includes('skills/rad-orchestration/scripts/pipeline.js'),
    'validator allow-list must not require the retired pipeline bundle');
  assert.ok(!REQUIRED_ARTIFACTS.includes('skills/rad-orchestration/scripts/explode-master-plan.js'),
    'validator allow-list must not require the retired explode-master-plan script');
});

test('gate 1: missing required artifact aborts (FR-31)', () => {
  const { root, canonicalDir } = makeValidOutput('1.0.0');
  fs.rmSync(join(root, 'hooks/bootstrap.mjs'));
  assert.throws(() => validatePluginTree({
    outputDir: root, canonicalAgentsDir: canonicalDir, sizer: () => ({ unpackedSize: 1024 }),
  }), /missing.*hooks\/bootstrap\.mjs/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(canonicalDir, { recursive: true, force: true });
});

test('gate 1: REQUIRED_ARTIFACTS includes .claude-plugin/plugin.json (Claude format detection)', () => {
  const { root, canonicalDir } = makeValidOutput('1.0.0');
  fs.rmSync(join(root, '.claude-plugin/plugin.json'));
  assert.throws(() => validatePluginTree({
    outputDir: root, canonicalAgentsDir: canonicalDir, sizer: () => ({ unpackedSize: 1024 }),
  }), /missing.*\.claude-plugin\/plugin\.json/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(canonicalDir, { recursive: true, force: true });
});

test('gate 2: missing canonical agent .agent.md (VS Code filename suffix) aborts (FR-31)', () => {
  const { root, canonicalDir } = makeValidOutput('1.0.0');
  fs.rmSync(join(root, 'agents/coder.agent.md'));
  assert.throws(() => validatePluginTree({
    outputDir: root, canonicalAgentsDir: canonicalDir, sizer: () => ({ unpackedSize: 1024 }),
  }), /missing.*agents\/coder\.agent\.md/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(canonicalDir, { recursive: true, force: true });
});

test('gate 3: missing per-version manifest aborts (FR-31, FR-34)', () => {
  const { root, canonicalDir } = makeValidOutput('1.0.0');
  fs.rmSync(join(root, 'manifests/v1.0.0.json'));
  assert.throws(() => validatePluginTree({
    outputDir: root, canonicalAgentsDir: canonicalDir, sizer: () => ({ unpackedSize: 1024 }),
  }), /missing.*manifests\/v1\.0\.0\.json/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(canonicalDir, { recursive: true, force: true });
});

test('gate 4: tarball size budget enforced (NFR-5)', () => {
  const { root, canonicalDir } = makeValidOutput('1.0.0');
  const oversize = Math.round(50 * 1024 * 1024 * 1.1) + 1;
  assert.throws(() => validatePluginTree({
    outputDir: root, canonicalAgentsDir: canonicalDir, sizer: () => ({ unpackedSize: oversize }),
  }), /exceeds size budget/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(canonicalDir, { recursive: true, force: true });
});

test('valid output passes every gate', () => {
  const { root, canonicalDir } = makeValidOutput('1.0.0');
  assert.doesNotThrow(() => validatePluginTree({
    outputDir: root, canonicalAgentsDir: canonicalDir, sizer: () => ({ unpackedSize: 1024 }),
  }));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(canonicalDir, { recursive: true, force: true });
});

test('namespaced-token gate is NOT enforced (FR-4, AD-10) — reviewer.agent.md with bare @coder dispatches passes', () => {
  const { root, canonicalDir } = makeValidOutput('1.0.0');
  fs.writeFileSync(join(root, 'agents/reviewer.agent.md'),
    '# reviewer\nDispatch the coder agent using `@coder`.\n');
  assert.doesNotThrow(() => validatePluginTree({
    outputDir: root, canonicalAgentsDir: canonicalDir, sizer: () => ({ unpackedSize: 1024 }),
  }), 'no namespaced-token enforcement (AD-10)');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(canonicalDir, { recursive: true, force: true });
});
