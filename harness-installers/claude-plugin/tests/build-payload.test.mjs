import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { runBuild } from '../build-scripts/build.js';

function makeUpstream() {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'build-'));
  // Adapter-engine output (claude only)
  fs.mkdirSync(join(root, 'harness-adapters/output/claude/agents'), { recursive: true });
  fs.writeFileSync(join(root, 'harness-adapters/output/claude/agents/reviewer.md'),
    '---\nname: reviewer\ndescription: test\n---\nSpawn **coder** agent. See ${SKILLS_ROOT}/rad-orchestration/SKILL.md.\n');
  fs.writeFileSync(join(root, 'harness-adapters/output/claude/agents/coder.md'),
    '---\nname: coder\ndescription: test\n---\n# Coder\n');
  fs.mkdirSync(join(root, 'harness-adapters/output/claude/skills/rad-orchestration'), { recursive: true });
  fs.writeFileSync(join(root, 'harness-adapters/output/claude/skills/rad-orchestration/SKILL.md'),
    '---\nname: rad-orchestration\ndescription: t\n---\nReference: ${SKILLS_ROOT}/rad-orchestration/scripts/radorch.mjs\n');
  // runtime-config/
  fs.mkdirSync(join(root, 'runtime-config/templates'), { recursive: true });
  fs.writeFileSync(join(root, 'runtime-config/orchestration.yml'), 'pipeline: {}\n');
  fs.writeFileSync(join(root, 'runtime-config/templates/medium.yml'), 'name: medium\n');
  // runtime-config/action-events/ — shipped catalog + empty custom/ slot (FR-1, FR-19, FR-20).
  fs.mkdirSync(join(root, 'runtime-config/action-events/custom'), { recursive: true });
  fs.writeFileSync(join(root, 'runtime-config/action-events/README.md'), '# action-events\n');
  fs.writeFileSync(join(root, 'runtime-config/action-events/action.spawn_coder.md'), '# spawn_coder\n');
  fs.writeFileSync(join(root, 'runtime-config/action-events/event.task_completed.md'), '# task_completed\n');
  // runtime-config/communication-styles/ — shipped style files + empty custom/ slot.
  fs.mkdirSync(join(root, 'runtime-config/communication-styles/custom'), { recursive: true });
  for (const style of ['direct.md', 'caveman.md', 'high-level.md', 'socratic.md']) {
    fs.writeFileSync(join(root, `runtime-config/communication-styles/${style}`), `# ${style}\n`);
  }
  // Documentation corpus — README.md, docs/, assets/ at the fixture root
  // (repoRoot == root for the copy-docs-corpus build step), including a page
  // under each excluded prefix.
  fs.writeFileSync(join(root, 'README.md'), '# fixture repo\n');
  fs.mkdirSync(join(root, 'docs/internals/private'), { recursive: true });
  fs.mkdirSync(join(root, 'docs/research'), { recursive: true });
  fs.writeFileSync(join(root, 'docs/getting-started.md'), '# getting started\n');
  fs.writeFileSync(join(root, 'docs/internals/system-architecture.md'), '# internals\n');
  fs.writeFileSync(join(root, 'docs/internals/private/fork-divergence.md'), '# private\n');
  fs.writeFileSync(join(root, 'docs/research/some-research.md'), '# research\n');
  fs.mkdirSync(join(root, 'assets'), { recursive: true });
  fs.writeFileSync(join(root, 'assets/diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // cli/ source synthetic
  fs.mkdirSync(join(root, 'cli/src/bin'), { recursive: true });
  fs.writeFileSync(join(root, 'cli/src/bin/radorch.ts'), 'console.log("radorch");\n');
  fs.writeFileSync(join(root, 'cli/package.json'), JSON.stringify({ name: 'cli', type: 'module' }));
  // canonical agents (harness-files/agents/) — required by validatePluginTree gate 2.
  fs.mkdirSync(join(root, 'harness-files/agents'), { recursive: true });
  fs.writeFileSync(join(root, 'harness-files/agents/reviewer.md'), 'Spawn **coder** agent.\n');
  fs.writeFileSync(join(root, 'harness-files/agents/coder.md'), '# Coder\n');
  // ui/ synthetic
  fs.mkdirSync(join(root, 'ui/.next/standalone'), { recursive: true });
  fs.mkdirSync(join(root, 'ui/.next/static'), { recursive: true });
  fs.writeFileSync(join(root, 'ui/.next/standalone/server.js'), '// ui\n');
  // installer source root: hooks/, lib/install/, .claude-plugin/, manifests/
  fs.mkdirSync(join(root, 'harness-installers/claude-plugin/hooks'), { recursive: true });
  fs.writeFileSync(join(root, 'harness-installers/claude-plugin/hooks/bootstrap.mjs'), 'console.error("boot");\n');
  fs.writeFileSync(join(root, 'harness-installers/claude-plugin/hooks/drift-check.mjs'), 'console.log("drift");\n');
  fs.writeFileSync(join(root, 'harness-installers/claude-plugin/hooks/hooks.json'), '{}\n');
  fs.writeFileSync(join(root, 'harness-installers/claude-plugin/hooks/AGENTS.md'), '# Hooks AGENTS\n');
  fs.mkdirSync(join(root, 'harness-installers/claude-plugin/.claude-plugin'), { recursive: true });
  fs.writeFileSync(join(root, 'harness-installers/claude-plugin/.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'rad-orc', version: '1.2.3' }, null, 2));
  fs.mkdirSync(join(root, 'harness-installers/claude-plugin/manifests'), { recursive: true });
  fs.writeFileSync(join(root, 'harness-installers/claude-plugin/manifests/v1.2.3.json'),
    JSON.stringify({ version: '1.2.3', files: [
      { destinationPath: '${RAD_HOME}/orchestration.yml', sourcePath: '_install-source/orchestration.yml', ownership: 'user-config' },
    ]}));
  fs.writeFileSync(join(root, 'harness-installers/claude-plugin/package.json'),
    JSON.stringify({ name: '@rad-orchestration/claude-plugin-source', private: true, type: 'module' }));
  return root;
}

test('runBuild emits the full plugin payload to output/ in correct shape', async () => {
  const root = makeUpstream();
  try {
    await runBuild({ rootDir: root, skipAdapterEngine: true, skipUiRunner: true, skipBootstrap: true, greenfieldRel: '.' });
    const out = join(root, 'harness-installers/claude-plugin/output');
    assert.ok(fs.existsSync(join(out, 'agents/reviewer.md')), 'agents copied');
    assert.ok(fs.existsSync(join(out, 'skills/rad-orchestration/SKILL.md')), 'skills copied');
    assert.ok(fs.existsSync(join(out, '_install-source/orchestration.yml')), 'orchestration.yml staged under _install-source/');
    assert.ok(fs.existsSync(join(out, '_install-source/templates/medium.yml')), 'templates staged under _install-source/');
    assert.ok(!fs.existsSync(join(out, 'orchestration.yml')), 'no top-level orchestration.yml shadow');
    assert.ok(!fs.existsSync(join(out, 'templates')), 'no top-level templates/ shadow');
    assert.ok(!fs.existsSync(join(out, 'skills/rad-orchestration/scripts/pipeline.js')), 'no legacy pipeline bundle');
    assert.ok(fs.existsSync(join(out, 'skills/rad-orchestration/scripts/radorch.mjs')), 'CLI bundle');
    assert.ok(fs.existsSync(join(out, 'hooks/bootstrap.mjs')), 'hook bundle');
    assert.ok(fs.existsSync(join(out, 'hooks/drift-check.mjs')), 'drift-check verbatim');
    assert.ok(fs.existsSync(join(out, 'hooks/hooks.json')), 'hooks.json verbatim');
    assert.ok(fs.existsSync(join(out, '.claude-plugin/plugin.json')), 'plugin.json');
    assert.ok(fs.existsSync(join(out, 'package.json')), 'package.json synthesized');
    assert.ok(fs.existsSync(join(out, 'manifests/v1.2.3.json')), 'manifest catalog');
    // bin/ filtered out.
    assert.ok(!fs.existsSync(join(out, 'bin')), 'no bin/');
    // Source-only files not present.
    assert.ok(!fs.existsSync(join(out, 'build-scripts')), 'no build-scripts/');
    assert.ok(!fs.existsSync(join(out, 'lib/install')), 'no source lib/install/');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('destination tokens are substituted across body files', async () => {
  const root = makeUpstream();
  try {
    await runBuild({ rootDir: root, skipAdapterEngine: true, skipUiRunner: true, skipBootstrap: true, greenfieldRel: '.' });
    const out = join(root, 'harness-installers/claude-plugin/output');
    const reviewer = fs.readFileSync(join(out, 'agents/reviewer.md'), 'utf8');
    assert.ok(reviewer.includes('${CLAUDE_PLUGIN_ROOT}/skills/rad-orchestration/SKILL.md'),
      '${SKILLS_ROOT} replaced with ${CLAUDE_PLUGIN_ROOT}/skills');
    assert.ok(reviewer.includes('**rad-orc:coder**'),
      'agent-namespacing applied');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('synthesized output/package.json version equals plugin.json version, not wrapper version', async () => {
  const root = makeUpstream();
  try {
    await runBuild({ rootDir: root, skipAdapterEngine: true, skipUiRunner: true, skipBootstrap: true, greenfieldRel: '.' });
    const synthesized = JSON.parse(fs.readFileSync(
      join(root, 'harness-installers/claude-plugin/output/package.json'), 'utf8'));
    assert.strictEqual(synthesized.version, '1.2.3', 'version from plugin.json');
    assert.strictEqual(synthesized.name, '@rad-orchestration/claude-plugin');
    assert.deepStrictEqual(synthesized.files.sort(), [
      '.claude-plugin/', '_install-source/', 'agents/', 'hooks/', 'lib/',
      'manifests/', 'skills/',
    ]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('build aborts fail-fast on step error', async () => {
  const root = makeUpstream();
  try {
    fs.rmSync(join(root, 'runtime-config/orchestration.yml'));
    await assert.rejects(runBuild({ rootDir: root, skipAdapterEngine: true, skipUiRunner: true, skipBootstrap: true, greenfieldRel: '.' }),
      /orchestration\.yml/, 'error names the failing step');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
