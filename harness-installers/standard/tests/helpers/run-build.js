// harness-installers/standard/tests/helpers/run-build.js —
// Per-installer test helper that stages a synthetic greenfield fixture and
// invokes the standard installer's `runBuild()` against it. Returns the
// resolved per-installer `output/` directory so tests can assert on what
// the build emitted.
//
// Per the harness-installer encapsulation rule, this helper is duplicated
// verbatim (with installer-specific adjustments) into each of the four
// installer trees — never `require` a sibling.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBuild as standardRunBuild } from '../../build-scripts/build.js';

const HARNESSES = ['claude', 'copilot-vscode', 'copilot-cli'];
const COPILOT_AGENT_SUFFIX_HARNESSES = new Set(['copilot-vscode', 'copilot-cli']);

function agentFilename(h, name) {
  return COPILOT_AGENT_SUFFIX_HARNESSES.has(h) ? `${name}.agent.md` : `${name}.md`;
}

/** Stage a self-contained synthetic greenfield tree under `root`, matching the
 *  layout expected by `runBuild` with `greenfieldRel: '.'`. Includes
 *  `runtime-config/action-events/` so the new copy-action-events build step
 *  has something to stage. */
function stageFixture(root) {
  for (const h of HARNESSES) {
    const agentsDir = path.join(root, 'harness-adapters/output', h, 'agents');
    const skillsDir = path.join(root, 'harness-adapters/output', h, 'skills/rad-orchestration');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, agentFilename(h, 'reviewer')),
      '---\nname: reviewer\ndescription: test\n---\n\nSpawn **coder** agent. See ${SKILLS_ROOT}/rad-orchestration/SKILL.md.\n',
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

  // runtime-config/ — orchestration.yml + templates + action-events/
  const rcDir = path.join(root, 'runtime-config');
  fs.mkdirSync(path.join(rcDir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(rcDir, 'orchestration.yml'), 'pipeline: {}\n');
  for (const tier of ['extra-high', 'high', 'medium', 'low']) {
    fs.writeFileSync(path.join(rcDir, `templates/${tier}.yml`), `name: ${tier}\n`);
  }
  // action-events/ — shipped README + a representative action and event file +
  // an empty custom/ slot with a synthetic user file that must NOT be copied
  // into the bundle (FR-20).
  const aeDir = path.join(rcDir, 'action-events');
  fs.mkdirSync(path.join(aeDir, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(aeDir, 'README.md'), '# action-events\n');
  fs.writeFileSync(path.join(aeDir, 'action.spawn_coder.md'), '# spawn_coder\n');
  fs.writeFileSync(path.join(aeDir, 'event.task_completed.md'), '# task_completed\n');
  fs.writeFileSync(path.join(aeDir, 'custom/action.user_added.pre.md'), '# user-authored — must not ship\n');

  // cli/ — esbuild needs a real entry to bundle.
  fs.mkdirSync(path.join(root, 'cli/src/bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cli/src/bin/radorch.ts'), 'console.log("radorch");\n');
  fs.writeFileSync(
    path.join(root, 'cli/package.json'),
    JSON.stringify({ name: 'cli', type: 'module', version: '0.0.0-fixture' }),
  );

  // ui/ — emit-ui-bundle's `runner` is stubbed via opts.skipUiRunner.
  fs.mkdirSync(path.join(root, 'ui/.next/standalone'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ui/.next/static'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/.next/standalone/server.js'), '// ui\n');

  // harness-files/agents/ — canonical agents listing for the validate step.
  const canonicalAgentsDir = path.join(root, 'harness-files/agents');
  fs.mkdirSync(canonicalAgentsDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalAgentsDir, 'reviewer.md'), '# reviewer\n');
  fs.writeFileSync(path.join(canonicalAgentsDir, 'coder.md'), '# coder\n');

  // harness-installers/standard/ source.
  const installerSrc = path.join(root, 'harness-installers/standard');
  fs.mkdirSync(installerSrc, { recursive: true });
  fs.writeFileSync(
    path.join(installerSrc, 'package.json'),
    JSON.stringify({
      name: '@rad-orchestration/standard-source',
      version: '1.0.0-alpha.12',
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

/**
 * Runs the standard installer's `runBuild()` against a synthetic fixture
 * staged under a fresh temp directory. Returns the per-installer output dir
 * (`output/` under the staged `harness-installers/standard/`).
 *
 * @param {{ cleanup?: boolean }} [opts]
 * @returns {Promise<{ outRoot: string, fixtureRoot: string, cleanup: () => void }>}
 */
export async function runBuild(opts = {}) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'std-build-helper-'));
  stageFixture(fixtureRoot);
  await standardRunBuild({
    rootDir: fixtureRoot,
    greenfieldRel: '.',
    skipAdapterEngine: true,
    skipUiRunner: true,
    skipBootstrap: true,
  });
  const outRoot = path.join(fixtureRoot, 'harness-installers/standard/output');
  const cleanup = () => {
    try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  };
  if (opts.cleanup) cleanup();
  return { outRoot, fixtureRoot, cleanup };
}
