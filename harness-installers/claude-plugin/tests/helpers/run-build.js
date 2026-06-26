// harness-installers/claude-plugin/tests/helpers/run-build.js —
// Per-installer test helper that stages a synthetic greenfield fixture and
// invokes the claude-plugin installer's `runBuild()` against it. Returns the
// resolved per-installer `output/` directory so tests can assert on what
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

const HARNESS = 'claude';
// Repo root, for the optional realRuntimeConfig seed (see runBuild).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Stage a self-contained synthetic greenfield tree under `root`, matching the
 *  layout expected by `runBuild` with `greenfieldRel: '.'`. Includes
 *  `runtime-config/action-events/` so the new copy-action-events build step
 *  has something to stage. */
function stageFixture(root) {
  const agentsDir = path.join(root, 'harness-adapters/output', HARNESS, 'agents');
  const skillsDir = path.join(root, 'harness-adapters/output', HARNESS, 'skills/rad-orchestration');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, 'orchestrator.md'),
    '---\nname: orchestrator\ndescription: test\n---\nSpawn **coder** agent. See ${SKILLS_ROOT}/rad-orchestration/SKILL.md.\n',
  );
  fs.writeFileSync(
    path.join(agentsDir, 'coder.md'),
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

  // cli/ — esbuild needs a real entry to bundle.
  fs.mkdirSync(path.join(root, 'cli/src/bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cli/src/bin/radorch.ts'), 'console.log("radorch");\n');
  fs.writeFileSync(path.join(root, 'cli/package.json'), JSON.stringify({ name: 'cli', type: 'module' }));

  // ui/ — stubbed.
  fs.mkdirSync(path.join(root, 'ui/.next/standalone'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ui/.next/static'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/.next/standalone/server.js'), '// ui\n');

  // canonical agents.
  fs.mkdirSync(path.join(root, 'harness-files/agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'harness-files/agents/orchestrator.md'), 'Spawn **coder** agent.\n');
  fs.writeFileSync(path.join(root, 'harness-files/agents/coder.md'), '# Coder\n');

  // installer source: hooks/, .claude-plugin/, manifests/, package.json
  const installerSrc = path.join(root, 'harness-installers/claude-plugin');
  fs.mkdirSync(path.join(installerSrc, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(installerSrc, 'hooks/bootstrap.mjs'), 'console.error("boot");\n');
  fs.writeFileSync(path.join(installerSrc, 'hooks/drift-check.mjs'), 'console.log("drift");\n');
  fs.writeFileSync(path.join(installerSrc, 'hooks/hooks.json'), '{}\n');
  fs.writeFileSync(path.join(installerSrc, 'hooks/AGENTS.md'), '# Hooks AGENTS\n');
  fs.mkdirSync(path.join(installerSrc, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(installerSrc, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'rad-orc', version: '1.2.3' }, null, 2));
  fs.mkdirSync(path.join(installerSrc, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(installerSrc, 'manifests/v1.2.3.json'),
    JSON.stringify({ version: '1.2.3', files: [
      { destinationPath: '${RAD_HOME}/orchestration.yml', sourcePath: '_install-source/orchestration.yml', ownership: 'user-config' },
    ]}));
  fs.writeFileSync(path.join(installerSrc, 'package.json'),
    JSON.stringify({ name: '@rad-orchestration/claude-plugin-source', private: true, type: 'module' }));
}

/**
 * Runs the claude-plugin installer's `runBuild()` against a synthetic fixture
 * staged under a fresh temp directory. Returns the per-installer output dir.
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
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-plugin-build-helper-'));
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
  const outRoot = path.join(fixtureRoot, 'harness-installers/claude-plugin/output');
  const cleanup = () => {
    try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  };
  if (opts.cleanup) cleanup();
  return { outRoot, fixtureRoot, cleanup };
}
