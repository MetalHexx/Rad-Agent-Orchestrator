import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { runBuild } from '../../build-scripts/build.js';

const HARNESSES = ['claude', 'copilot-vscode', 'copilot-cli'];
const COPILOT_AGENT_SUFFIX_HARNESSES = new Set(['copilot-vscode', 'copilot-cli']);

function agentFilename(h, name) {
  return COPILOT_AGENT_SUFFIX_HARNESSES.has(h) ? `${name}.agent.md` : `${name}.md`;
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'std-build-'));

  // Per-harness adapter engine output. Each harness gets agents + skills with
  // tokenized references the build's expand-tokens step must replace. Filename
  // suffix follows the adapter rule: claude `<name>.md`, copilot `<name>.agent.md`.
  for (const h of HARNESSES) {
    const agentsDir = path.join(root, 'harness-adapters/output', h, 'agents');
    const skillsDir = path.join(root, 'harness-adapters/output', h, 'skills/rad-orchestration');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, agentFilename(h, 'reviewer')),
      [
        '---',
        'name: reviewer',
        'description: test',
        '---',
        '',
        'Spawn **coder** agent. The **planner** writes the plan.',
        'See ${SKILLS_ROOT}/rad-orchestration/SKILL.md.',
        'Plugin root is ${PLUGIN_ROOT}.',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(agentsDir, agentFilename(h, 'coder')),
      '---\nname: coder\ndescription: test\n---\n# Coder\n',
    );
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      '---\nname: rad-orchestration\ndescription: t\n---\nReference: ${SKILLS_ROOT}/rad-orchestration/scripts/radorch.mjs\n',
    );
  }

  // runtime-config/
  const rcDir = path.join(root, 'runtime-config');
  const rcTemplates = path.join(rcDir, 'templates');
  fs.mkdirSync(rcTemplates, { recursive: true });
  fs.writeFileSync(path.join(rcDir, 'orchestration.yml'), 'pipeline: {}\n');
  for (const tier of ['extra-high', 'high', 'medium', 'low']) {
    fs.writeFileSync(path.join(rcTemplates, `${tier}.yml`), `name: ${tier}\n`);
  }
  // runtime-config/action-events/ — shipped catalog + empty custom/ slot (FR-1, FR-19, FR-20).
  const aeDir = path.join(rcDir, 'action-events');
  fs.mkdirSync(path.join(aeDir, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(aeDir, 'README.md'), '# action-events\n');
  fs.writeFileSync(path.join(aeDir, 'action.spawn_coder.md'), '# spawn_coder\n');
  fs.writeFileSync(path.join(aeDir, 'event.task_completed.md'), '# task_completed\n');

  // runtime-config/communication-styles/ — shipped style files + empty custom/ slot.
  const csDir = path.join(rcDir, 'communication-styles');
  fs.mkdirSync(path.join(csDir, 'custom'), { recursive: true });
  for (const style of ['direct.md', 'caveman.md', 'high-level.md', 'socratic.md']) {
    fs.writeFileSync(path.join(csDir, style), `# ${style}\n`);
  }

  // Documentation corpus — README.md, docs/, assets/ at the fixture root
  // (repoRoot == root for the copy-docs-corpus build step). Minimal: enough
  // for the step to succeed.
  fs.writeFileSync(path.join(root, 'README.md'), '# fixture repo\n');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/getting-started.md'), '# getting started\n');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  // cli/ source — synthetic. esbuild needs a real entry to bundle, but the
  // unit test skips emitCliBundle by virtue of the helper being called and
  // tolerating a trivial entry. We don't skip it: we provide a real entry.
  const cliBin = path.join(root, 'cli/src/bin');
  fs.mkdirSync(cliBin, { recursive: true });
  fs.writeFileSync(path.join(cliBin, 'radorch.ts'), 'console.log("radorch");\n');
  fs.writeFileSync(
    path.join(root, 'cli/package.json'),
    JSON.stringify({ name: 'cli', type: 'module', version: '0.0.0-fixture' }),
  );

  // ui/ — emit-ui-bundle's `runner` will be stubbed via opts.skipUiRunner.
  // We still need the .next/standalone + static dirs to exist so the helper's
  // cpSync succeeds; the runner stub does nothing.
  fs.mkdirSync(path.join(root, 'ui/.next/standalone'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ui/.next/static'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/.next/standalone/server.js'), '// ui\n');

  // harness-files/agents/ — canonical agents dir required by the validate step.
  // Must list only the agents that also appear in output/<harness>/agents/ so
  // gate 2 passes. The adapter output above ships reviewer.md + coder.md.
  const canonicalAgentsDir = path.join(root, 'harness-files/agents');
  fs.mkdirSync(canonicalAgentsDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalAgentsDir, 'reviewer.md'), '# reviewer\n');
  fs.writeFileSync(path.join(canonicalAgentsDir, 'coder.md'), '# coder\n');

  // harness-installers/standard/ source — needs package.json for synth.
  const installerSrc = path.join(root, 'harness-installers/standard');
  fs.mkdirSync(installerSrc, { recursive: true });
  fs.writeFileSync(
    path.join(installerSrc, 'package.json'),
    JSON.stringify({
      name: '@rad-orchestration/standard-source',
      version: '1.0.0-alpha.14',
      private: true,
      type: 'module',
      description: 'Standard installer source wrapper.',
      author: 'rad-orchestration',
      license: 'MIT',
      homepage: 'https://example.test/home',
      repository: { type: 'git', url: 'https://example.test/repo' },
      bugs: { url: 'https://example.test/bugs' },
      keywords: ['orchestration', 'installer'],
      dependencies: { chalk: '^5.0.0' },
      devDependencies: { esbuild: '^0.24.0' },
    }, null, 2),
  );
  // manifests/<harness>/ dirs (emit-manifest writes into them); leave empty.
  for (const h of HARNESSES) {
    fs.mkdirSync(path.join(installerSrc, 'manifests', h), { recursive: true });
  }

  // harness-installers/shared/hooks/ — source for the copy-hook-shim build step (FR-18).
  const sharedHooksDir = path.join(root, 'harness-installers/shared/hooks');
  fs.mkdirSync(sharedHooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(sharedHooksDir, 'session-preamble.mjs'),
    '// session-preamble.mjs shim (fixture)\n',
  );
  fs.writeFileSync(
    path.join(sharedHooksDir, 'telemetry-capture.mjs'),
    '// telemetry-capture.mjs shim (fixture)\n',
  );

  return root;
}

test('runBuild produces output/<harness>/ per harness and shared output/ui/', async () => {
  const root = makeFixture();
  try {
    await runBuild({
      rootDir: root,
      greenfieldRel: '.',
      skipAdapterEngine: true,
      skipUiRunner: true,
      skipBootstrap: true,
    });
    const out = path.join(root, 'harness-installers/standard/output');

    // Per-harness payload (FR-19, FR-20, FR-21, FR-22).
    for (const h of HARNESSES) {
      const hOut = path.join(out, h);
      const reviewerFile = agentFilename(h, 'reviewer');
      assert.ok(fs.existsSync(path.join(hOut, 'agents', reviewerFile)),
        `${h}: agents/${reviewerFile}`);
      assert.ok(fs.existsSync(path.join(hOut, 'skills/rad-orchestration/SKILL.md')),
        `${h}: skills/rad-orchestration/SKILL.md`);
      assert.ok(fs.existsSync(path.join(hOut, 'orchestration.yml')),
        `${h}: orchestration.yml`);
      assert.ok(fs.existsSync(path.join(hOut, 'templates/medium.yml')),
        `${h}: templates/medium.yml`);
      assert.ok(fs.existsSync(path.join(hOut, 'skills/rad-orchestration/scripts/radorch.mjs')),
        `${h}: bundled CLI`);
      assert.ok(!fs.existsSync(path.join(hOut, 'skills/rad-orchestration/scripts/pipeline.js')),
        `${h}: no legacy pipeline bundle`);
      // v5 entries retire — neither is shipped (FR-22).
      assert.ok(!fs.existsSync(path.join(hOut, 'skills/rad-orchestration/scripts/migrate-to-v5.js')),
        `${h}: no migrate-to-v5.js`);
      assert.ok(!fs.existsSync(path.join(hOut, 'skills/rad-orchestration/scripts/fix-ghost-v5.js')),
        `${h}: no fix-ghost-v5.js`);
      // Prune-pass: stray TS source is gone.
      assert.ok(!fs.existsSync(path.join(hOut, 'skills/rad-orchestration/scripts/stray.ts')),
        `${h}: stray.ts pruned`);
      // Per-harness manifest copy-forward (FR-25, AD-4).
      assert.ok(fs.existsSync(path.join(hOut, 'manifests/v1.0.0-alpha.14.json')),
        `${h}: per-harness manifest copied forward`);
    }

    // UI bundle emitted ONCE at top-level output/ui.tgz — never per-harness (FR-23, AD-9).
    // Tarball shape (not a loose tree) so node_modules/ and .next/ survive
    // `npm pack`'s hardcoded node_modules strip; the installer extracts on hydrate.
    assert.ok(fs.existsSync(path.join(out, 'ui.tgz')),
      'output/ui.tgz exists at top level');
    for (const h of HARNESSES) {
      assert.ok(!fs.existsSync(path.join(out, h, 'ui')),
        `output/${h}/ui/ must NOT exist (AD-9)`);
      assert.ok(!fs.existsSync(path.join(out, h, 'ui.tgz')),
        `output/${h}/ui.tgz must NOT exist (AD-9)`);
    }

    // Content tokens are DEFERRED to install time (FR-24, AD-6, AD-16).
    // The build must NOT bake any absolute home path into the prebuilt bundle:
    // ${SKILLS_ROOT}/${PLUGIN_ROOT} survive as literal tokens in output/ and are
    // resolved per-user by installManifestFiles. Baking os.homedir() here was a
    // latent bug (ships the build machine's home to every user + makes the
    // manifest sha non-reproducible across platforms).
    const reviewerClaude = fs.readFileSync(path.join(out, 'claude/agents/reviewer.md'), 'utf8');
    assert.ok(reviewerClaude.includes('${SKILLS_ROOT}/rad-orchestration/SKILL.md'),
      'claude reviewer.md: ${SKILLS_ROOT} preserved as a token (resolved at install)');
    assert.ok(reviewerClaude.includes('${PLUGIN_ROOT}'),
      'claude reviewer.md: ${PLUGIN_ROOT} preserved as a token (resolved at install)');
    assert.ok(!reviewerClaude.includes(os.homedir()),
      'claude reviewer.md: build machine home dir must NOT be baked into the bundle');
    // AD-6: no namespacing rewrite — agent body still references bare names.
    assert.ok(reviewerClaude.includes('**coder**'),
      'claude reviewer.md: **coder** kept bare (no rad-orc: prefix)');
    assert.ok(reviewerClaude.includes('**planner**'),
      'claude reviewer.md: **planner** kept bare (no rad-orc: prefix)');
    assert.ok(!reviewerClaude.includes('rad-orc:coder'),
      'claude: no rad-orc:coder namespacing applied (AD-6)');

    for (const h of ['copilot-vscode', 'copilot-cli']) {
      const reviewer = fs.readFileSync(path.join(out, h, 'agents', agentFilename(h, 'reviewer')), 'utf8');
      assert.ok(reviewer.includes('${SKILLS_ROOT}'), `${h}: ${`\${SKILLS_ROOT}`} preserved as a token`);
      assert.ok(reviewer.includes('${PLUGIN_ROOT}'), `${h}: ${`\${PLUGIN_ROOT}`} preserved as a token`);
      assert.ok(!reviewer.includes(os.homedir()), `${h}: build machine home dir must NOT be baked in`);
      assert.ok(reviewer.includes('**coder**'),
        `${h} reviewer.md: **coder** kept bare (no rad-orc: prefix)`);
    }

    // Build no longer synthesizes a top-level output/package.json — the source-side
    // standard/package.json IS the publish package.json now, and `npm pack` runs
    // from standard/ (one level up from output/).
    assert.ok(!fs.existsSync(path.join(out, 'package.json')),
      'output/package.json is not produced by the build (pack site is standard/)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('standard installer publish package.json names rad-orc (AD-9)', async () => {
  const pkgPath = path.resolve(import.meta.dirname, '../../package.json');
  const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'));
  assert.strictEqual(pkg.name, 'rad-orc');
  assert.ok(pkg.bin && Object.prototype.hasOwnProperty.call(pkg.bin, 'rad-orc'));
  assert.ok(!Object.prototype.hasOwnProperty.call(pkg.bin || {}, 'rad-orchestration'),
    'legacy bin name removed (FR-6)');
});

test('npm pack --dry-run reports name rad-orc (FR-6)', () => {
  const standardDir = path.resolve(import.meta.dirname, '../..');
  const out = execSync('npm pack --dry-run --json', {
    cwd: standardDir,
    encoding: 'utf8',
  });
  const [meta] = JSON.parse(out);
  assert.strictEqual(meta.name, 'rad-orc');
});

