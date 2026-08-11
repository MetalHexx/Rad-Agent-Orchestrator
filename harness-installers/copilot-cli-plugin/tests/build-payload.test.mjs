import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path, { join } from 'node:path';
import { runBuild } from '../build-scripts/build.js';

function makeFixtureRoot() {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'cli-build-'));
  // Synthetic fixture: only the source trees the build script reads.
  // greenfieldRel='.' flattens the layout so root acts as both repo root and greenfield root.
  fs.mkdirSync(join(root, 'harness-adapters/output/copilot-cli/agents'), { recursive: true });
  fs.mkdirSync(join(root, 'harness-adapters/output/copilot-cli/skills/rad-x/references'), { recursive: true });
  fs.writeFileSync(join(root, 'harness-adapters/output/copilot-cli/agents/coder.agent.md'),
    'See ${SKILLS_ROOT}/rad-x/SKILL.md and ${PLUGIN_ROOT}/hooks/.\n');
  fs.writeFileSync(join(root, 'harness-adapters/output/copilot-cli/skills/rad-x/SKILL.md'),
    'subagent_type: coder\nSee ${SKILLS_ROOT}/rad-x/references/r.md\n');
  fs.writeFileSync(join(root, 'harness-adapters/output/copilot-cli/skills/rad-x/references/r.md'),
    'Dispatch the coder, planner, and reviewer agents.\n');

  fs.mkdirSync(join(root, 'runtime-config/templates'), { recursive: true });
  fs.writeFileSync(join(root, 'runtime-config/orchestration.yml'), 'pipeline: {}\n');
  for (const t of ['extra-high', 'high', 'medium', 'low']) {
    fs.writeFileSync(join(root, `runtime-config/templates/${t}.yml`), `name: ${t}\n`);
  }
  // runtime-config/action-events/ — shipped catalog + empty custom/ slot (FR-1, FR-19, FR-20).
  fs.mkdirSync(join(root, 'runtime-config/action-events/custom'), { recursive: true });
  fs.writeFileSync(join(root, 'runtime-config/action-events/README.md'), '# action-events\n');
  fs.writeFileSync(join(root, 'runtime-config/action-events/action.spawn_coder.md'), '# spawn_coder\n');
  fs.writeFileSync(join(root, 'runtime-config/action-events/event.task_completed.md'), '# task_completed\n');

  // Synthetic cli/ and ui/ source roots — minimal stubs so emit-cli-bundle
  // and emit-ui-bundle (with skipUiRunner) can run.
  fs.mkdirSync(join(root, 'cli/src/bin'), { recursive: true });
  fs.writeFileSync(join(root, 'cli/src/bin/radorch.ts'), 'export const hi = () => "ok";\n');
  fs.writeFileSync(join(root, 'cli/package.json'), JSON.stringify({ name: 'cli', type: 'module' }));
  fs.mkdirSync(join(root, 'ui'), { recursive: true });

  // The installer package itself — source-side plugin.json, hooks/, lib/install/, manifests/.
  const installerDir = join(root, 'harness-installers/copilot-cli-plugin');
  fs.mkdirSync(join(installerDir, 'hooks'), { recursive: true });
  fs.mkdirSync(join(installerDir, 'lib/install'), { recursive: true });
  fs.mkdirSync(join(installerDir, 'manifests'), { recursive: true });
  fs.writeFileSync(join(installerDir, 'plugin.json'), JSON.stringify({
    name: 'rad-orc',
    version: '1.0.0-alpha.13',
    author: { name: 'metalhexx' },
    license: 'MIT',
  }));
  fs.writeFileSync(join(installerDir, 'package.json'), JSON.stringify({
    name: '@rad-orchestration/copilot-cli-plugin-source',
    version: '1.0.0-alpha.13',
    private: true,
    type: 'module',
    license: 'MIT',
    engines: { node: '>=20' },
  }));
  fs.writeFileSync(join(installerDir, 'hooks/bootstrap.mjs'),
    "import './../lib/install/run-install.js';\nconsole.error('boot');\n");
  fs.writeFileSync(join(installerDir, 'lib/install/run-install.js'),
    'export async function runInstall() { return { action: "noop" }; }\n');
  fs.writeFileSync(join(installerDir, 'hooks/drift-check.mjs'), '// drift-check verbatim\n');
  fs.writeFileSync(join(installerDir, 'hooks/hooks.json'),
    JSON.stringify({ version: 1, hooks: { userPromptSubmitted: [], sessionStart: [] } }, null, 2));
  fs.writeFileSync(join(installerDir, 'manifests/v1.0.0-alpha.13.json'),
    JSON.stringify({ version: '1.0.0-alpha.13', channel: 'copilot-cli-plugin', files: [] }));
  return root;
}

test('runBuild produces a full output/ tree with adapter content, runtime-config, bundles, hooks, plugin.json, and manifests (FR-24, FR-25, DD-5)', async () => {
  const root = makeFixtureRoot();
  try {
    await runBuild({
      rootDir: root,
      greenfieldRel: '.',
      skipAdapterEngine: true, // fixture pre-populates adapter output
      skipBootstrap: true,     // synthetic fixture has no real package.json sub-trees to bootstrap
      skipUiRunner: true,      // synthetic fixture has no real Next.js to build
    });
    const out = join(root, 'harness-installers/copilot-cli-plugin/output');
    assert.ok(fs.existsSync(join(out, 'plugin.json')), 'plugin.json at payload root (FR-36)');
    assert.ok(fs.existsSync(join(out, 'package.json')), 'synthesized package.json');
    assert.ok(fs.existsSync(join(out, 'agents/coder.agent.md')), 'agent .agent.md filename per Copilot (FR-29 gate 2)');
    assert.ok(fs.existsSync(join(out, 'skills/rad-x/SKILL.md')));
    assert.ok(fs.existsSync(join(out, '_install-source/orchestration.yml')), 'runtime-config staged under _install-source/');
    assert.ok(fs.existsSync(join(out, '_install-source/templates/medium.yml')));
    assert.ok(!fs.existsSync(join(out, 'orchestration.yml')), 'no top-level orchestration.yml shadow');
    assert.ok(!fs.existsSync(join(out, 'templates')), 'no top-level templates/ shadow');
    assert.ok(fs.existsSync(join(out, 'skills/rad-orchestration/scripts/radorch.mjs')), 'CLI bundle (FR-31)');
    assert.ok(!fs.existsSync(join(out, 'skills/rad-orchestration/scripts/pipeline.js')), 'no legacy pipeline bundle');
    assert.ok(fs.existsSync(join(out, 'hooks/hooks.json')));
    assert.ok(fs.existsSync(join(out, 'hooks/bootstrap.mjs')), 'bundled bootstrap');
    assert.ok(fs.existsSync(join(out, 'hooks/drift-check.mjs')), 'verbatim drift-check');
    assert.ok(fs.existsSync(join(out, 'manifests/v1.0.0-alpha.13.json')));
    // No .claude-plugin/ subfolder per FR-36.
    assert.ok(!fs.existsSync(join(out, '.claude-plugin')), '.claude-plugin/ absent — plugin.json at root');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('expand-tokens substitutes destination tokens across agents+skills WITHOUT agent-namespacing (FR-3, FR-27, AD-10, AD-17, NFR-13)', async () => {
  const root = makeFixtureRoot();
  try {
    await runBuild({
      rootDir: root, greenfieldRel: '.',
      skipAdapterEngine: true, skipBootstrap: true, skipUiRunner: true,
    });
    const out = join(root, 'harness-installers/copilot-cli-plugin/output');
    const agent = fs.readFileSync(join(out, 'agents/coder.agent.md'), 'utf8');
    assert.ok(agent.includes('${COPILOT_CLI_PLUGIN_ROOT}/skills/rad-x/SKILL.md'), '${SKILLS_ROOT} substituted (FR-27)');
    assert.ok(agent.includes('${COPILOT_CLI_PLUGIN_ROOT}/hooks/'), '${PLUGIN_ROOT} substituted (FR-27)');
    assert.ok(!agent.includes('rad-orc:'), 'NO agent-namespacing transform (FR-3, AD-10)');
    const refs = fs.readFileSync(join(out, 'skills/rad-x/references/r.md'), 'utf8');
    assert.ok(!refs.includes('rad-orc:coder'), 'reference docs unchanged (NFR-13)');
    const skill = fs.readFileSync(join(out, 'skills/rad-x/SKILL.md'), 'utf8');
    assert.ok(skill.includes('subagent_type: coder'), 'subagent_type bare (no namespacing — AD-10)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hooks tree excluded from expand-tokens scope (FR-25)', async () => {
  const root = makeFixtureRoot();
  // Inject a token into the hooks source — it must NOT be substituted.
  fs.writeFileSync(join(root, 'harness-installers/copilot-cli-plugin/hooks/drift-check.mjs'),
    '// references ${SKILLS_ROOT}/dummy unchanged at build time\n');
  try {
    await runBuild({
      rootDir: root, greenfieldRel: '.',
      skipAdapterEngine: true, skipBootstrap: true, skipUiRunner: true,
    });
    const out = join(root, 'harness-installers/copilot-cli-plugin/output');
    const drift = fs.readFileSync(join(out, 'hooks/drift-check.mjs'), 'utf8');
    assert.ok(drift.includes('${SKILLS_ROOT}/dummy'), 'hooks tree NOT in expand-tokens scope (FR-25)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('synthesized output/package.json declares the published name @rad-orchestration/copilot-cli-plugin (FR-30, FR-31, DD-10)', async () => {
  const root = makeFixtureRoot();
  try {
    await runBuild({
      rootDir: root, greenfieldRel: '.',
      skipAdapterEngine: true, skipBootstrap: true, skipUiRunner: true,
    });
    const pkg = JSON.parse(fs.readFileSync(join(root, 'harness-installers/copilot-cli-plugin/output/package.json'), 'utf8'));
    assert.strictEqual(pkg.name, '@rad-orchestration/copilot-cli-plugin', 'published name (FR-31)');
    assert.strictEqual(pkg.version, '1.0.0-alpha.13', 'version stamped from plugin.json');
    for (const required of ['plugin.json', 'agents/', 'skills/', 'hooks/', 'manifests/']) {
      assert.ok(pkg.files.includes(required), `pkg.files must include ${required}`);
    }
    assert.ok(!pkg.files.some((f) => f.startsWith('.claude-plugin/')), 'no .claude-plugin/ in files (FR-36)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
