import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path, { join } from 'node:path';
import { runBuild } from '../build-scripts/build.js';

function makeFixtureRoot() {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'vsc-build-'));
  // Synthetic adapter output for copilot-vscode. Agent filename suffix .agent.md per VS Code's filename rule.
  fs.mkdirSync(join(root, 'harness-adapters/output/copilot-vscode/agents'), { recursive: true });
  fs.mkdirSync(join(root, 'harness-adapters/output/copilot-vscode/skills/rad-x/references'), { recursive: true });
  fs.writeFileSync(join(root, 'harness-adapters/output/copilot-vscode/agents/coder.agent.md'),
    'model: Claude Opus 4.7 (copilot)\nSee ${SKILLS_ROOT}/rad-x/SKILL.md and ${PLUGIN_ROOT}/hooks/.\n');
  fs.writeFileSync(join(root, 'harness-adapters/output/copilot-vscode/skills/rad-x/SKILL.md'),
    'subagent_type: coder\nSee ${SKILLS_ROOT}/rad-x/references/r.md\n');
  fs.writeFileSync(join(root, 'harness-adapters/output/copilot-vscode/skills/rad-x/references/r.md'),
    'Dispatch the coder, planner, and reviewer agents.\n');

  // runtime-config/ inputs.
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

  // Synthetic cli/ and ui/ stubs so emit-cli-bundle and emit-ui-bundle run.
  fs.mkdirSync(join(root, 'cli/src/bin'), { recursive: true });
  fs.writeFileSync(join(root, 'cli/src/bin/radorch.ts'), 'export const hi = () => "ok";\n');
  fs.writeFileSync(join(root, 'cli/package.json'), JSON.stringify({ name: 'cli', type: 'module' }));
  fs.mkdirSync(join(root, 'ui'), { recursive: true });

  // Canonical agents directory for validate gate 2.
  fs.mkdirSync(join(root, 'harness-files/agents'), { recursive: true });
  fs.writeFileSync(join(root, 'harness-files/agents/coder.md'), '# coder');

  // The installer package itself — source-side plugin.json, hooks/, lib/install/, manifests/.
  const installerDir = join(root, 'harness-installers/copilot-vscode-plugin');
  fs.mkdirSync(join(installerDir, 'hooks'), { recursive: true });
  fs.mkdirSync(join(installerDir, 'lib/install'), { recursive: true });
  fs.mkdirSync(join(installerDir, 'manifests'), { recursive: true });
  fs.mkdirSync(join(installerDir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(join(installerDir, '.claude-plugin/plugin.json'), JSON.stringify({
    name: 'rad-orc-vscode',
    version: '1.0.0-alpha.10',
    author: { name: 'metalhexx' },
    license: 'MIT',
    hooks: 'hooks/hooks.json',
  }));
  fs.writeFileSync(join(installerDir, 'package.json'), JSON.stringify({
    name: '@rad-orchestration/copilot-vscode-plugin-source',
    version: '1.0.0-alpha.10',
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
    JSON.stringify({ hooks: { UserPromptSubmit: [], SessionStart: [] } }, null, 2));
  fs.writeFileSync(join(installerDir, 'manifests/v1.0.0-alpha.10.json'),
    JSON.stringify({ version: '1.0.0-alpha.10', channel: 'copilot-vscode-plugin', files: [] }));
  return root;
}

test('runBuild produces a full output/ tree with plugin.json under .claude-plugin/, .agent.md filenames, bundles, hooks, manifests (FR-26, DD-5)', async () => {
  const root = makeFixtureRoot();
  try {
    await runBuild({
      rootDir: root,
      skipAdapterEngine: true,
      skipBootstrap: true,
      skipUiRunner: true,
    });
    const out = join(root, 'harness-installers/copilot-vscode-plugin/output');
    assert.ok(fs.existsSync(join(out, '.claude-plugin/plugin.json')), 'plugin.json under .claude-plugin/ (Claude format → CLAUDE_PLUGIN_ROOT injection)');
    assert.ok(!fs.existsSync(join(out, 'plugin.json')), 'no root plugin.json (Copilot format would shadow Claude detection)');
    assert.ok(fs.existsSync(join(out, 'package.json')), 'synthesized package.json (FR-32)');
    assert.ok(fs.existsSync(join(out, 'agents/coder.agent.md')), 'agent .agent.md filename per VS Code (FR-26)');
    assert.ok(fs.existsSync(join(out, 'skills/rad-x/SKILL.md')));
    assert.ok(fs.existsSync(join(out, '_install-source/orchestration.yml')), 'runtime-config staged under _install-source/');
    assert.ok(fs.existsSync(join(out, '_install-source/templates/medium.yml')));
    assert.ok(!fs.existsSync(join(out, 'orchestration.yml')), 'no top-level orchestration.yml shadow');
    assert.ok(!fs.existsSync(join(out, 'templates')), 'no top-level templates/ shadow');
    assert.ok(fs.existsSync(join(out, 'skills/rad-orchestration/scripts/radorch.mjs')), 'CLI bundle');
    assert.ok(!fs.existsSync(join(out, 'skills/rad-orchestration/scripts/pipeline.js')), 'no legacy pipeline bundle');
    assert.ok(fs.existsSync(join(out, 'hooks/hooks.json')));
    assert.ok(fs.existsSync(join(out, 'hooks/bootstrap.mjs')), 'bundled bootstrap');
    assert.ok(fs.existsSync(join(out, 'hooks/drift-check.mjs')), 'verbatim drift-check');
    assert.ok(fs.existsSync(join(out, 'manifests/v1.0.0-alpha.10.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('expand-tokens substitutes destination tokens across agents+skills WITHOUT agent-namespacing (FR-3, FR-4, FR-29, AD-10, AD-17, NFR-13)', async () => {
  const root = makeFixtureRoot();
  try {
    await runBuild({ rootDir: root, skipAdapterEngine: true, skipBootstrap: true, skipUiRunner: true });
    const out = join(root, 'harness-installers/copilot-vscode-plugin/output');
    const agent = fs.readFileSync(join(out, 'agents/coder.agent.md'), 'utf8');
    assert.ok(agent.includes('${COPILOT_VSCODE_PLUGIN_ROOT}/skills/rad-x/SKILL.md'), '${SKILLS_ROOT} substituted to COPILOT_VSCODE_PLUGIN_ROOT (FR-29)');
    assert.ok(agent.includes('${COPILOT_VSCODE_PLUGIN_ROOT}/hooks/'), '${PLUGIN_ROOT} substituted (FR-29)');
    assert.ok(!agent.includes('rad-orc-vscode:'), 'NO agent-namespacing transform (FR-4, AD-10)');
    // The (copilot) model identifier suffix survives token substitution unchanged (FR-3 — adapter-shipped).
    assert.ok(agent.includes('Claude Opus 4.7 (copilot)'), 'model identifier (copilot) suffix preserved verbatim (FR-3)');
    const skill = fs.readFileSync(join(out, 'skills/rad-x/SKILL.md'), 'utf8');
    assert.ok(skill.includes('subagent_type: coder'), 'subagent_type bare (no namespacing — AD-10)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hooks tree excluded from expand-tokens scope (FR-27)', async () => {
  const root = makeFixtureRoot();
  // Inject a token into the hooks source — it must NOT be substituted.
  fs.writeFileSync(join(root, 'harness-installers/copilot-vscode-plugin/hooks/drift-check.mjs'),
    '// references ${SKILLS_ROOT}/dummy unchanged at build time\n');
  try {
    await runBuild({ rootDir: root, skipAdapterEngine: true, skipBootstrap: true, skipUiRunner: true });
    const out = join(root, 'harness-installers/copilot-vscode-plugin/output');
    const drift = fs.readFileSync(join(out, 'hooks/drift-check.mjs'), 'utf8');
    assert.ok(drift.includes('${SKILLS_ROOT}/dummy'), 'hooks tree NOT in expand-tokens scope (FR-27)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('synthesized output/package.json declares the published name @rad-orchestration/copilot-vscode-plugin (FR-32, FR-33, DD-10)', async () => {
  const root = makeFixtureRoot();
  try {
    await runBuild({ rootDir: root, skipAdapterEngine: true, skipBootstrap: true, skipUiRunner: true });
    const pkg = JSON.parse(fs.readFileSync(join(root, 'harness-installers/copilot-vscode-plugin/output/package.json'), 'utf8'));
    assert.strictEqual(pkg.name, '@rad-orchestration/copilot-vscode-plugin', 'published name (FR-33)');
    assert.strictEqual(pkg.version, '1.0.0-alpha.10', 'version stamped from plugin.json');
    for (const f of ['.claude-plugin/', 'agents/', 'skills/', 'hooks/', 'manifests/', '_install-source/']) {
      assert.ok(pkg.files.includes(f), `files[] includes ${f}`);
    }
    for (const f of ['orchestration.yml', 'templates/', 'ui/']) {
      assert.ok(!pkg.files.includes(f), `files[] must not include ${f} (now under _install-source/)`);
    }
    assert.ok(!pkg.files.includes('plugin.json'), 'no root plugin.json in files (Claude format ships it under .claude-plugin/)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
