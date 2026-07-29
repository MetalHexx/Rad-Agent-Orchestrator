import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePackageTree, REQUIRED_PER_HARNESS } from '../../build-scripts/validate.js';

const HARNESSES = ['claude', 'copilot-vscode', 'copilot-cli'];
const COPILOT_AGENT_SUFFIX_HARNESSES = new Set(['copilot-vscode', 'copilot-cli']);
const VERSION = '1.0.0-alpha.12';

test('REQUIRED_PER_HARNESS no longer includes the retired pipeline bundle', () => {
  assert.ok(!REQUIRED_PER_HARNESS.includes('skills/rad-orchestration/scripts/pipeline.js'),
    'validator allow-list must not require the retired pipeline bundle');
  assert.ok(!REQUIRED_PER_HARNESS.includes('skills/rad-orchestration/scripts/explode-master-plan.js'),
    'validator allow-list must not require the retired explode-master-plan script');
});

/** Build a minimal synthetic output tree satisfying all four gates. */
function makeValidDist(root, canonicalAgentsDir, agents = ['reviewer', 'coder']) {
  for (const h of HARNESSES) {
    const hOut = path.join(root, h);
    // Required per-harness artifacts (gate 1)
    fs.mkdirSync(path.join(hOut, 'skills/rad-orchestration/scripts'), { recursive: true });
    fs.mkdirSync(path.join(hOut, 'templates'), { recursive: true });
    fs.mkdirSync(path.join(hOut, 'action-events/custom'), { recursive: true });
    fs.writeFileSync(path.join(hOut, 'orchestration.yml'), 'pipeline: {}\n');
    for (const tier of ['extra-high', 'high', 'medium', 'low']) {
      fs.writeFileSync(path.join(hOut, `templates/${tier}.yml`), `name: ${tier}\n`);
    }
    fs.writeFileSync(path.join(hOut, 'skills/rad-orchestration/scripts/radorch.mjs'), '// radorch\n');
    fs.writeFileSync(path.join(hOut, 'action-events/README.md'), '# action-events\n');
    // Canonical agents (gate 2). Per-harness filename suffix matches the adapter:
    // claude emits `<name>.md`, copilot variants emit `<name>.agent.md`.
    fs.mkdirSync(path.join(hOut, 'agents'), { recursive: true });
    const suffix = COPILOT_AGENT_SUFFIX_HARNESSES.has(h) ? '.agent.md' : '.md';
    for (const name of agents) {
      fs.writeFileSync(path.join(hOut, `agents/${name}${suffix}`), `# ${name}\n`);
    }
    // Per-harness manifest (gate 3)
    fs.mkdirSync(path.join(hOut, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(hOut, `manifests/v${VERSION}.json`), '{"files":[]}\n');
  }
}

/** Build a synthetic canonical agents dir with the given agent basenames. */
function makeCanonicalAgentsDir(root, agents = ['reviewer', 'coder']) {
  const dir = path.join(root, 'canonical-agents');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of agents) {
    fs.writeFileSync(path.join(dir, `${name}.md`), `# ${name}\n`);
  }
  return dir;
}

test('gate 1: missing required artifact throws (radorch.mjs)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-gate1-'));
  try {
    const outputDir = path.join(root, 'output');
    const canonicalAgentsDir = makeCanonicalAgentsDir(root, ['reviewer', 'coder']);
    makeValidDist(outputDir, canonicalAgentsDir, ['reviewer', 'coder']);
    // Remove radorch.mjs from the claude harness to trigger gate 1
    fs.rmSync(path.join(outputDir, 'claude/skills/rad-orchestration/scripts/radorch.mjs'));
    assert.throws(
      () => validatePackageTree({ outputDir, canonicalAgentsDir, harnesses: HARNESSES, version: VERSION }),
      (err) => {
        assert.ok(err.message.includes('radorch.mjs'), `Expected message to name radorch.mjs, got: ${err.message}`);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate 2: missing canonical agent in output throws (coder.md)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-gate2-'));
  try {
    const outputDir = path.join(root, 'output');
    const canonicalAgentsDir = makeCanonicalAgentsDir(root, ['reviewer', 'coder']);
    makeValidDist(outputDir, canonicalAgentsDir, ['reviewer', 'coder']);
    // Remove coder.md from the claude harness agents directory
    fs.rmSync(path.join(outputDir, 'claude/agents/coder.md'));
    assert.throws(
      () => validatePackageTree({ outputDir, canonicalAgentsDir, harnesses: HARNESSES, version: VERSION }),
      (err) => {
        assert.ok(err.message.includes('coder.md'), `Expected message to name coder.md, got: ${err.message}`);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate 2: missing copilot-suffixed agent in output throws (coder.agent.md)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-gate2-copilot-'));
  try {
    const outputDir = path.join(root, 'output');
    const canonicalAgentsDir = makeCanonicalAgentsDir(root, ['reviewer', 'coder']);
    makeValidDist(outputDir, canonicalAgentsDir, ['reviewer', 'coder']);
    // Remove the .agent.md-suffixed file from copilot-vscode. The validator must
    // check the documented per-harness suffix; bare `.md` here would be wrong.
    fs.rmSync(path.join(outputDir, 'copilot-vscode/agents/coder.agent.md'));
    assert.throws(
      () => validatePackageTree({ outputDir, canonicalAgentsDir, harnesses: HARNESSES, version: VERSION }),
      (err) => {
        assert.ok(
          err.message.includes('copilot-vscode/agents/coder.agent.md'),
          `Expected message to name copilot-vscode/agents/coder.agent.md, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate 3: missing per-harness manifest throws', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-gate3-'));
  try {
    const outputDir = path.join(root, 'output');
    const canonicalAgentsDir = makeCanonicalAgentsDir(root, ['reviewer', 'coder']);
    makeValidDist(outputDir, canonicalAgentsDir, ['reviewer', 'coder']);
    // Remove the manifest for claude harness
    fs.rmSync(path.join(outputDir, `claude/manifests/v${VERSION}.json`));
    assert.throws(
      () => validatePackageTree({ outputDir, canonicalAgentsDir, harnesses: HARNESSES, version: VERSION }),
      (err) => {
        assert.ok(
          err.message.includes(`v${VERSION}.json`),
          `Expected message to name v${VERSION}.json, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate 4: tarball size exceeds budget throws', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-gate4-'));
  try {
    const outputDir = path.join(root, 'output');
    const canonicalAgentsDir = makeCanonicalAgentsDir(root, ['reviewer', 'coder']);
    makeValidDist(outputDir, canonicalAgentsDir, ['reviewer', 'coder']);
    const bigSizer = () => ({ unpackedSize: 60 * 1024 * 1024 });
    assert.throws(
      () => validatePackageTree({
        outputDir,
        canonicalAgentsDir,
        harnesses: HARNESSES,
        version: VERSION,
        sizer: bigSizer,
      }),
      (err) => {
        assert.ok(
          /size|budget/i.test(err.message),
          `Expected message to mention size/budget, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('happy path: valid synthetic output passes all four gates without throwing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-happy-'));
  try {
    const outputDir = path.join(root, 'output');
    const canonicalAgentsDir = makeCanonicalAgentsDir(root, ['reviewer', 'coder']);
    makeValidDist(outputDir, canonicalAgentsDir, ['reviewer', 'coder']);
    // Use a sizer that returns an acceptable size
    const okSizer = () => ({ unpackedSize: 10 * 1024 * 1024 });
    assert.doesNotThrow(
      () => validatePackageTree({
        outputDir,
        canonicalAgentsDir,
        harnesses: HARNESSES,
        version: VERSION,
        sizer: okSizer,
      }),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
