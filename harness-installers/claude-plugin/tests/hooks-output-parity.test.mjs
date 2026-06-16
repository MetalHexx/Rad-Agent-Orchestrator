import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = 'harness-installers/claude-plugin/hooks/hooks.json';
const OUT = 'harness-installers/claude-plugin/output/hooks/hooks.json';
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('committed output hooks.json matches source verbatim (FR-9, AD-9)', () => {
  assert.deepEqual(load(OUT), load(SRC));
});
test('source registers the 3 telemetry events at telemetry-capture.mjs (FR-9)', () => {
  const s = load(SRC);
  assert.equal(s.hooks.PostToolUse[0].matcher, 'Agent');
  const cmds = [...s.hooks.PostToolUse, ...s.hooks.Stop, ...s.hooks.SessionEnd]
    .map((e) => e.hooks[0].command);
  assert.equal(cmds.filter((c) => c.includes('telemetry-capture.mjs')).length, 3);
});
