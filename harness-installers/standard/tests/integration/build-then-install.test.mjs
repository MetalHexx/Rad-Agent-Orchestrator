// harness-installers/standard/tests/integration/build-then-install.test.mjs —
// End-to-end cross-phase integration test. Stages a synthetic greenfield tree
// under a tmp dir, runs the real `runBuild` against it (with adapter-engine /
// ui-runner / bootstrap skipped), and then drives `installHarness` and
// `hydrateUserData` against the produced `output/<harness>/` payload. Asserts
// on the resulting `~/.radorc/` and `~/.<harness>/` on-disk shapes against
// every FR-2 / FR-3 / FR-14 / FR-15 / FR-16 expectation in a single test.
//
// This test is the cross-cutting validator that exercises P03+P04 modules
// together — when it fails, the fix belongs in the originating module, never
// in the test (the test is the spec of these requirements acting together).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runBuild } from '../../build-scripts/build.js';
import { installHarness } from '../../lib/install/install-harness.js';
import { hydrateUserData } from '../../lib/install/hydrate-user-data.js';

const HARNESSES = ['claude', 'copilot-vscode', 'copilot-cli'];
const COPILOT_AGENT_SUFFIX_HARNESSES = new Set(['copilot-vscode', 'copilot-cli']);

function agentFilename(h, name) {
  return COPILOT_AGENT_SUFFIX_HARNESSES.has(h) ? `${name}.agent.md` : `${name}.md`;
}

/**
 * Stage a self-contained synthetic greenfield tree under `root`. Mirrors the
 * structure expected by `runBuild` with `greenfieldRel: '.'` — i.e. the
 * greenfield content lives at the root rather than under a subfolder.
 * Returns nothing; everything is written to disk.
 */
function makeFixture(root) {
  // Per-harness adapter engine output — agents + skills with tokenized
  // references that the build's expand-tokens step will replace. Filename
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
        'Spawn **coder** agent. See ${SKILLS_ROOT}/rad-orchestration/SKILL.md.',
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

  // runtime-config/ — orchestration.yml + four tier templates.
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

  // cli/ source — esbuild needs a real entry to bundle.
  const cliBin = path.join(root, 'cli/src/bin');
  fs.mkdirSync(cliBin, { recursive: true });
  fs.writeFileSync(path.join(cliBin, 'radorch.ts'), 'console.log("radorch");\n');
  fs.writeFileSync(
    path.join(root, 'cli/package.json'),
    JSON.stringify({ name: 'cli', type: 'module', version: '0.0.0-fixture' }),
  );

  // ui/ — emit-ui-bundle's `runner` is stubbed via opts.skipUiRunner. The
  // helper still cpSync's .next/standalone + static; we provide those dirs.
  fs.mkdirSync(path.join(root, 'ui/.next/standalone/ui'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ui/.next/static'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/.next/standalone/ui/server.js'), '// ui\n');

  // harness-files/agents/ — canonical agents listing for the validate step.
  const canonicalAgentsDir = path.join(root, 'harness-files/agents');
  fs.mkdirSync(canonicalAgentsDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalAgentsDir, 'reviewer.md'), '# reviewer\n');
  fs.writeFileSync(path.join(canonicalAgentsDir, 'coder.md'), '# coder\n');

  // harness-installers/standard/ source — needs package.json for synthesize.
  const installerSrc = path.join(root, 'harness-installers/standard');
  fs.mkdirSync(installerSrc, { recursive: true });
  fs.writeFileSync(
    path.join(installerSrc, 'package.json'),
    JSON.stringify({
      name: '@rad-orchestration/standard-source',
      version: '1.0.0-alpha.10',
      private: true,
      type: 'module',
      description: 'Standard installer source wrapper (fixture).',
      author: 'rad-orchestration',
      license: 'MIT',
      dependencies: { chalk: '^5.0.0' },
    }, null, 2),
  );
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
}

test('build then install produces correct ~/.radorc/ and ~/.<harness>/ shapes for each harness', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'std-e2e-'));
  // Capture and restore HOME / USERPROFILE so we don't pollute the real user
  // home if the test throws between set and finally-block.
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  try {
    makeFixture(tmp);

    // Point HOME and USERPROFILE at a fresh tmp home BEFORE installHarness /
    // hydrateUserData, both of which call userDataPaths() / harnessRoot() to
    // resolve the install root AND (now) the ${PLUGIN_ROOT}/${SKILLS_ROOT}
    // content tokens. The build itself no longer touches os.homedir() — those
    // tokens are deferred to install time — but the install path does.
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home, { recursive: true });
    process.env.HOME = home;
    process.env.USERPROFILE = home;

    // Build against the synthetic fixture.
    await runBuild({
      rootDir: tmp,
      greenfieldRel: '.',
      skipAdapterEngine: true,
      skipUiRunner: true,
      skipBootstrap: true,
    });

    const outputRoot = path.join(tmp, 'harness-installers/standard/output');

    // Regression guard (cross-platform manifest reproducibility): the PREBUILT
    // bundle must retain the raw ${SKILLS_ROOT} token and must NOT contain the
    // build machine's home dir — expansion is the installer's job, below.
    const bundleSkill = fs.readFileSync(
      path.join(outputRoot, 'claude/skills/rad-orchestration/SKILL.md'), 'utf8');
    assert.ok(bundleSkill.includes('${SKILLS_ROOT}'),
      'bundle SKILL.md retains ${SKILLS_ROOT} token (build must not bake home dir)');
    assert.ok(!bundleSkill.includes(home),
      'bundle SKILL.md must not contain the build machine home dir');

    // Install each harness against the real output/<h>/ payload. The
    // copilot-cli ↔ copilot-vscode folder mutex is tested separately in P03;
    // here we install claude and copilot-vscode (which can coexist on disk).
    for (const h of ['claude', 'copilot-vscode']) {
      const result = await installHarness({
        bundleRoot: path.join(outputRoot, h),
        sharedRoot: outputRoot,
        harness: h,
        stderr: { write() { /* swallow */ } },
      });
      assert.strictEqual(result.code, 0, `${h} install must succeed (got action=${result.action})`);
    }

    // Hydrate user-data from one of the per-harness bundles. The shared UI
    // bundle lives at output/ui/, so sharedRoot = outputRoot.
    await hydrateUserData({
      bundleRoot: path.join(outputRoot, 'claude'),
      sharedRoot: outputRoot,
    });

    // ---------------------------------------------------------------------
    // FR-2: ~/.radorc/ shape — canonical single-shape user-data tree.
    // ---------------------------------------------------------------------
    const rad = path.join(home, '.radorc');
    assert.ok(fs.existsSync(path.join(rad, 'install.json')),
      'FR-2: install.json present');
    assert.ok(fs.existsSync(path.join(rad, 'orchestration.yml')),
      'FR-2: orchestration.yml present');
    assert.ok(fs.existsSync(path.join(rad, 'templates/extra-high.yml')),
      'FR-2: templates/extra-high.yml present');
    assert.ok(fs.existsSync(path.join(rad, 'templates/high.yml')),
      'FR-2: templates/high.yml present');
    assert.ok(fs.existsSync(path.join(rad, 'templates/medium.yml')),
      'FR-2: templates/medium.yml present');
    assert.ok(fs.existsSync(path.join(rad, 'templates/low.yml')),
      'FR-2: templates/low.yml present');
    assert.ok(fs.existsSync(path.join(rad, 'ui')), 'FR-2: ui/ present');
    assert.ok(fs.existsSync(path.join(rad, 'projects')), 'FR-2: projects/ present');
    assert.ok(fs.existsSync(path.join(rad, 'logs')), 'FR-2: logs/ present');

    // FR-2 negative shape — none of the legacy artifacts may be created.
    assert.ok(!fs.existsSync(path.join(rad, 'config.yml')),
      'FR-2: no config.yml (legacy)');
    assert.ok(!fs.existsSync(path.join(rad, 'registry.yml')),
      'FR-2: no registry.yml (legacy)');
    assert.ok(!fs.existsSync(path.join(rad, '.harness')),
      'FR-2: no .harness pointer');
    assert.ok(!fs.existsSync(path.join(rad, 'runtime')),
      'FR-2: no runtime/ — UI creates it lazily, not the installer');

    // ---------------------------------------------------------------------
    // FR-3: per-harness install root populated for each installed harness.
    // ---------------------------------------------------------------------
    assert.ok(fs.existsSync(path.join(home, '.claude/agents/reviewer.md')),
      'FR-3: claude reviewer.md installed');
    assert.ok(fs.existsSync(path.join(home, '.claude/agents/coder.md')),
      'FR-3: claude coder.md installed');
    assert.ok(fs.existsSync(path.join(home, '.claude/skills/rad-orchestration/scripts/radorch.mjs')),
      'FR-3: claude CLI sentinel installed');
    assert.ok(!fs.existsSync(path.join(home, '.claude/skills/rad-orchestration/scripts/pipeline.js')),
      'no legacy pipeline shipped');
    assert.ok(fs.existsSync(path.join(home, '.claude/skills/rad-orchestration/SKILL.md')),
      'FR-3: claude SKILL.md installed');

    assert.ok(fs.existsSync(path.join(home, '.copilot/agents/reviewer.agent.md')),
      'FR-3: copilot reviewer.agent.md installed');
    assert.ok(fs.existsSync(path.join(home, '.copilot/skills/rad-orchestration/scripts/radorch.mjs')),
      'FR-3: copilot CLI sentinel installed');

    // FR-3 content fidelity — the installed agent must carry the token-
    // expanded body (not the bundle's raw `${SKILLS_ROOT}` placeholder).
    const claudeReviewer = fs.readFileSync(
      path.join(home, '.claude/agents/reviewer.md'), 'utf8');
    assert.ok(!claudeReviewer.includes('${SKILLS_ROOT}'),
      'FR-3: claude reviewer.md token-expanded (no bare ${SKILLS_ROOT})');
    assert.ok(claudeReviewer.includes(path.join(home, '.claude')),
      'FR-3: claude reviewer.md references ~/.claude/');

    // ---------------------------------------------------------------------
    // FR-14: orchestration.yml preservation on second hydrate.
    // ---------------------------------------------------------------------
    const userEdited = '# user-edited content\n';
    fs.writeFileSync(path.join(rad, 'orchestration.yml'), userEdited);
    await hydrateUserData({
      bundleRoot: path.join(outputRoot, 'claude'),
      sharedRoot: outputRoot,
    });
    assert.strictEqual(
      fs.readFileSync(path.join(rad, 'orchestration.yml'), 'utf8'),
      userEdited,
      'FR-14: user-edited orchestration.yml preserved on second hydrate',
    );

    // ---------------------------------------------------------------------
    // FR-15: user-added template preserved; shipped tier files overwrite.
    // ---------------------------------------------------------------------
    fs.writeFileSync(path.join(rad, 'templates/my-custom.yml'), 'custom');
    const shippedBefore = fs.readFileSync(
      path.join(rad, 'templates/extra-high.yml'), 'utf8');
    fs.writeFileSync(path.join(rad, 'templates/extra-high.yml'), 'tampered');
    await hydrateUserData({
      bundleRoot: path.join(outputRoot, 'claude'),
      sharedRoot: outputRoot,
    });
    assert.strictEqual(
      fs.readFileSync(path.join(rad, 'templates/my-custom.yml'), 'utf8'),
      'custom',
      'FR-15: user-added template my-custom.yml preserved',
    );
    assert.strictEqual(
      fs.readFileSync(path.join(rad, 'templates/extra-high.yml'), 'utf8'),
      shippedBefore,
      'FR-15: shipped tier file (extra-high.yml) overwritten from bundle',
    );

    // ---------------------------------------------------------------------
    // FR-16: ui/ replaced atomically — prior file gone, new bundle content
    //        present after re-hydrate.
    // ---------------------------------------------------------------------
    const stalePath = path.join(rad, 'ui/stale-from-prior-install.js');
    fs.writeFileSync(stalePath, '// stale\n');
    await hydrateUserData({
      bundleRoot: path.join(outputRoot, 'claude'),
      sharedRoot: outputRoot,
    });
    assert.ok(!fs.existsSync(stalePath),
      'FR-16: prior ui/ contents wiped on re-hydrate (atomic tmp-rename)');
    assert.ok(fs.existsSync(path.join(rad, 'ui', 'ui', 'server.js')),
      'FR-16: bundle ui/ui/server.js present after re-hydrate (nested standalone layout)');

    // ---------------------------------------------------------------------
    // NFR-10c: ~/.radorc/projects/ is never written into by manifest copies.
    // ---------------------------------------------------------------------
    fs.mkdirSync(path.join(rad, 'projects/sample'), { recursive: true });
    fs.writeFileSync(path.join(rad, 'projects/sample/state.json'), '{}');
    // Re-install claude (this will hit the noop or upgrade path depending on
    // whether the sentinel + install.json entry match — either way no copies
    // may land in projects/).
    await installHarness({
      bundleRoot: path.join(outputRoot, 'claude'),
      sharedRoot: outputRoot,
      harness: 'claude',
      stderr: { write() { /* swallow */ } },
    });
    assert.ok(fs.existsSync(path.join(rad, 'projects/sample/state.json')),
      'NFR-10c: ~/.radorc/projects/sample/state.json survives second install');
    assert.strictEqual(
      fs.readFileSync(path.join(rad, 'projects/sample/state.json'), 'utf8'),
      '{}',
      'NFR-10c: projects/ file contents untouched',
    );
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
