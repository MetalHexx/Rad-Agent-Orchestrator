// harness-installers/copilot-cli-plugin/tests/helpers/run-build.js —
// Per-installer test helper that stages a synthetic greenfield fixture and
// invokes the copilot-cli-plugin installer's `runBuild()` against it. Returns
// the resolved per-installer `output/` directory so tests can assert on what
// the build emitted.
//
// Per the harness-installer encapsulation rule, this helper is duplicated
// verbatim (with installer-specific adjustments) into each of the four
// installer trees — never `require` a sibling.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild as pluginRunBuild } from '../../build-scripts/build.js';

const HARNESS = 'copilot-cli';
// Repo root, for the optional realRuntimeConfig seed (see runBuild).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function stageFixture(root) {
  const agentsDir = path.join(root, 'harness-adapters/output', HARNESS, 'agents');
  const skillsDir = path.join(root, 'harness-adapters/output', HARNESS, 'skills/rad-orchestration');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, 'orchestrator.agent.md'),
    '---\nname: orchestrator\ndescription: test\n---\nSee ${SKILLS_ROOT}/rad-orchestration/SKILL.md.\n',
  );
  fs.writeFileSync(
    path.join(agentsDir, 'coder.agent.md'),
    '---\nname: coder\ndescription: test\n---\n# Coder\n',
  );
  fs.writeFileSync(
    path.join(skillsDir, 'SKILL.md'),
    '---\nname: rad-orchestration\ndescription: t\n---\nReference: ${SKILLS_ROOT}/rad-orchestration/scripts/radorch.mjs\n',
  );

  // runtime-config/ — orchestration.yml + templates + action-events/
  const rcDir = path.join(root, 'runtime-config');
  fs.mkdirSync(path.join(rcDir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(rcDir, 'orchestration.yml'), 'pipeline: {}\n');
  fs.writeFileSync(path.join(rcDir, 'templates/medium.yml'), 'name: medium\n');
  const aeDir = path.join(rcDir, 'action-events');
  fs.mkdirSync(path.join(aeDir, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(aeDir, 'README.md'), '# action-events\n');
  fs.writeFileSync(path.join(aeDir, 'action.spawn_coder.md'), '# spawn_coder\n');
  fs.writeFileSync(path.join(aeDir, 'event.task_completed.md'), '# task_completed\n');
  fs.writeFileSync(path.join(aeDir, 'custom/action.user_added.pre.md'), '# user-authored — must not ship\n');

  // cli/ — esbuild stub.
  fs.mkdirSync(path.join(root, 'cli/src/bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cli/src/bin/radorch.ts'), 'console.log("radorch");\n');
  fs.writeFileSync(path.join(root, 'cli/package.json'), JSON.stringify({ name: 'cli', type: 'module' }));

  // ui/ — stubbed.
  fs.mkdirSync(path.join(root, 'ui/.next/standalone'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ui/.next/static'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/.next/standalone/server.js'), '// ui\n');

  // canonical agents.
  fs.mkdirSync(path.join(root, 'harness-files/agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'harness-files/agents/orchestrator.md'), '# orchestrator\n');
  fs.writeFileSync(path.join(root, 'harness-files/agents/coder.md'), '# Coder\n');

  // installer source: hooks/, plugin.json at root, manifests/, package.json
  const installerSrc = path.join(root, 'harness-installers/copilot-cli-plugin');
  fs.mkdirSync(path.join(installerSrc, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(installerSrc, 'hooks/bootstrap.mjs'), 'console.error("boot");\n');
  fs.writeFileSync(path.join(installerSrc, 'hooks/drift-check.mjs'), '// drift\n');
  fs.writeFileSync(path.join(installerSrc, 'hooks/hooks.json'),
    JSON.stringify({ version: 1, hooks: { userPromptSubmitted: [], sessionStart: [] } }, null, 2));
  fs.writeFileSync(path.join(installerSrc, 'plugin.json'),
    JSON.stringify({ name: 'rad-orc', version: '1.0.0-alpha.9', author: { name: 'metalhexx' }, license: 'MIT' }));
  fs.mkdirSync(path.join(installerSrc, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(installerSrc, 'manifests/v1.0.0-alpha.9.json'),
    JSON.stringify({ version: '1.0.0-alpha.9', channel: 'copilot-cli-plugin', files: [] }));
  fs.writeFileSync(path.join(installerSrc, 'package.json'),
    JSON.stringify({
      name: '@rad-orchestration/copilot-cli-plugin-source',
      version: '1.0.0-alpha.9', private: true, type: 'module', license: 'MIT',
      engines: { node: '>=20' },
    }));
}

/**
 * Runs the copilot-cli-plugin installer's `runBuild()` against a synthetic
 * fixture staged under a fresh temp directory.
 *
 * When `realRuntimeConfig` is set, the synthetic runtime-config/ is replaced
 * with a copy of the repo's real one before building, so callers can verify the
 * committed manifest catalog against the actual installable _install-source/
 * payload (see manifest-payload-parity.test.mjs). The build stays isolated in a
 * tmp dir, so it never races the shared real output/ tree.
 *
 * @param {{ cleanup?: boolean, realRuntimeConfig?: boolean }} [opts]
 * @returns {Promise<{ outRoot: string, fixtureRoot: string, cleanup: () => void }>}
 */
export async function runBuild(opts = {}) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-cli-plugin-build-helper-'));
  stageFixture(fixtureRoot);
  if (opts.realRuntimeConfig) {
    const rc = path.join(fixtureRoot, 'runtime-config');
    fs.rmSync(rc, { recursive: true, force: true });
    fs.cpSync(path.join(REPO_ROOT, 'runtime-config'), rc, { recursive: true });
  }
  await pluginRunBuild({
    rootDir: fixtureRoot,
    greenfieldRel: '.',
    skipAdapterEngine: true,
    skipUiRunner: true,
    skipBootstrap: true,
  });
  const outRoot = path.join(fixtureRoot, 'harness-installers/copilot-cli-plugin/output');
  const cleanup = () => {
    try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  };
  if (opts.cleanup) cleanup();
  return { outRoot, fixtureRoot, cleanup };
}
