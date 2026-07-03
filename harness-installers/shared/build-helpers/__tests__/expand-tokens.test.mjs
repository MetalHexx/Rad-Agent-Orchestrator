import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandTokens } from '../expand-tokens.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'expand-tokens-'));
  mkdirSync(join(root, 'in/agents'), { recursive: true });
  mkdirSync(join(root, 'in/skills/rad-x/references'), { recursive: true });
  writeFileSync(join(root, 'in/agents/coder.md'),
    'Spawn **coder** agent.\nSee ${SKILLS_ROOT}/rad-x/SKILL.md.\nUse ${PLUGIN_ROOT}/hooks/.\n');
  writeFileSync(join(root, 'in/skills/rad-x/SKILL.md'),
    'subagent_type: planner\nSee ${SKILLS_ROOT}/rad-x/references/r.md\n');
  writeFileSync(join(root, 'in/skills/rad-x/references/r.md'),
    'Dispatch the coder, planner, and reviewer agents.\n');
  // A non-text file that must be copied verbatim, not corrupted.
  writeFileSync(join(root, 'in/skills/rad-x/binary.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return root;
}

test('expandTokens substitutes destination tokens and applies agent-namespacing across every text-extension file', async () => {
  const root = makeFixture();
  try {
    await expandTokens({
      source: join(root, 'in'),
      target: join(root, 'out'),
      tokenMap: {
        '${SKILLS_ROOT}': '${CLAUDE_PLUGIN_ROOT}/skills',
        '${PLUGIN_ROOT}': '${CLAUDE_PLUGIN_ROOT}',
      },
      agentNames: ['coder', 'planner', 'reviewer'],
    });
    const agent = readFileSync(join(root, 'out/agents/coder.md'), 'utf8');
    assert.ok(agent.includes('**rad-orc:coder**'), 'bold dispatch token namespaced');
    assert.ok(agent.includes('${CLAUDE_PLUGIN_ROOT}/skills/rad-x/SKILL.md'), '${SKILLS_ROOT} substituted');
    assert.ok(agent.includes('${CLAUDE_PLUGIN_ROOT}/hooks/'), '${PLUGIN_ROOT} substituted');
    const skill = readFileSync(join(root, 'out/skills/rad-x/SKILL.md'), 'utf8');
    assert.ok(skill.includes('subagent_type: rad-orc:planner'), 'subagent_type namespaced');
    const refs = readFileSync(join(root, 'out/skills/rad-x/references/r.md'), 'utf8');
    assert.ok(refs.includes('rad-orc:coder, rad-orc:planner, and rad-orc:reviewer agents'),
      'comma-list dispatch namespaced');
    const bin = readFileSync(join(root, 'out/skills/rad-x/binary.png'));
    assert.deepStrictEqual([...bin], [0x89, 0x50, 0x4e, 0x47], 'binary file copied verbatim');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('expandTokens preserves the POSIX file mode of rewritten text files (no exec-bit drop)', async () => {
  // Regression: in the plugin build, emit-cli-bundle chmods radorch.mjs to 0o755 so
  // it runs directly on POSIX. expand-tokens later rewrites that file via writeFileSync;
  // without explicit mode preservation the exec bit is silently dropped to the default 0o644.
  if (process.platform === 'win32') return; // POSIX-only assertion
  const root = mkdtempSync(join(tmpdir(), 'expand-tokens-mode-'));
  try {
    mkdirSync(join(root, 'in/skills/rad-x/scripts'), { recursive: true });
    const src = join(root, 'in/skills/rad-x/scripts/radorch.mjs');
    writeFileSync(src, '#!/usr/bin/env node\n// uses ${SKILLS_ROOT} placeholder\n');
    chmodSync(src, 0o755);
    await expandTokens({
      source: join(root, 'in'),
      target: join(root, 'out'),
      tokenMap: { '${SKILLS_ROOT}': '${CLAUDE_PLUGIN_ROOT}/skills' },
      agentNames: [],
    });
    const outMode = statSync(join(root, 'out/skills/rad-x/scripts/radorch.mjs')).mode & 0o777;
    assert.strictEqual(outMode, 0o755, 'rewritten file keeps the source 0o755 mode');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('expandTokens leaves unknown ${...} tokens untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'expand-tokens-unknown-'));
  try {
    mkdirSync(join(root, 'in'), { recursive: true });
    writeFileSync(join(root, 'in/x.md'), 'Reference ${UNKNOWN_TOKEN}/foo.\n');
    await expandTokens({
      source: join(root, 'in'),
      target: join(root, 'out'),
      tokenMap: { '${SKILLS_ROOT}': '/replaced' },
      agentNames: [],
    });
    const text = readFileSync(join(root, 'out/x.md'), 'utf8');
    assert.ok(text.includes('${UNKNOWN_TOKEN}/foo'), 'unknown token passes through unchanged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
