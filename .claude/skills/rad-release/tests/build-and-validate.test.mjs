import test from 'node:test';
import assert from 'node:assert/strict';
import { runBuildAndValidate } from '../scripts/build-and-validate.mjs';

test('runBuildAndValidate invokes the standard installer build then each plugin build', async () => {
  const calls = [];
  const result = await runBuildAndValidate({
    repoRoot: process.cwd(),
    spawn: (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts?.cwd });
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  // First call: the standard installer build (all harnesses)
  assert.deepStrictEqual(calls[0].args, ['harness-installers/standard/build-scripts/build.js']);
  // Subsequent calls: per-plugin builders invoked from the repo root with the
  // plugin's build.js as the path arg (plugin builds read process.cwd() as
  // their rootDir, so cwd must be the repo root, not the plugin dir).
  const pluginCalls = calls.slice(1);
  for (const c of pluginCalls) assert.strictEqual(c.cwd, process.cwd());
  const pluginScripts = pluginCalls.map(c => c.args[0]);
  assert.ok(pluginScripts.some(p => p.includes('claude-plugin/build-scripts/build.js')));
  assert.ok(pluginScripts.some(p => p.includes('copilot-cli-plugin/build-scripts/build.js')));
  assert.ok(pluginScripts.some(p => p.includes('copilot-vscode-plugin/build-scripts/build.js')));
  assert.strictEqual(result.ok, true);
});

test('runBuildAndValidate surfaces a non-zero exit as a halt', async () => {
  const result = await runBuildAndValidate({
    repoRoot: process.cwd(),
    spawn: () => ({ status: 1, stdout: '', stderr: 'validator gate failed' }),
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /validator gate failed/);
});
