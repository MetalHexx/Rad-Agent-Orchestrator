import assert from 'node:assert';
import { isValidSessionId } from './session-logic';
import { buildClaudeCommand } from './claude-command';
import { buildChildEnv } from './child-env';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}

const FIXED = '11111111-2222-4333-8444-555555555555';

console.log('brainstorm-poc helpers');

test('isValidSessionId accepts a UUID and rejects junk / injection', () => {
  assert.strictEqual(isValidSessionId(FIXED), true);
  assert.strictEqual(isValidSessionId('not-a-uuid'), false);
  assert.strictEqual(isValidSessionId('x" && rm -rf /'), false);
});

test('first-turn command creates with --session-id and loads a normal session', () => {
  const cmd = buildClaudeCommand({ sessionId: FIXED, isFirstTurn: true });
  assert.ok(cmd.startsWith('claude -p '));
  assert.ok(cmd.includes(`--session-id ${FIXED}`));
  assert.ok(!cmd.includes('--resume'));
  // A normal session: hooks/skills/CLAUDE.md/memory/tools all load (the Max-plan
  // guarantee comes from buildChildEnv, not from these flags).
  assert.ok(!cmd.includes('--safe-mode'));
  assert.ok(!cmd.includes('--tools'));
  // headless can't prompt, so it runs in auto permission mode
  assert.ok(cmd.includes('--permission-mode auto'));
  assert.ok(cmd.includes('--output-format json'));
});

test('later-turn command resumes and never re-mints', () => {
  const cmd = buildClaudeCommand({ sessionId: FIXED, isFirstTurn: false });
  assert.ok(cmd.includes(`--resume ${FIXED}`));
  assert.ok(!cmd.includes('--session-id'));
});

test('buildChildEnv strips every metered credential and keeps the rest', () => {
  const env = buildChildEnv({
    ANTHROPIC_API_KEY: 'sk-xxx',
    ANTHROPIC_AUTH_TOKEN: 'tok',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
    PATH: '/usr/bin',
    FOO: 'bar',
  } as unknown as NodeJS.ProcessEnv);
  assert.strictEqual(env.ANTHROPIC_API_KEY, undefined);
  assert.strictEqual(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.strictEqual(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.strictEqual(env.CLAUDE_CODE_USE_VERTEX, undefined);
  assert.strictEqual(env.PATH, '/usr/bin');
  assert.strictEqual(env.FOO, 'bar');
});

test('buildChildEnv does not mutate the parent env', () => {
  const parent = { ANTHROPIC_API_KEY: 'sk-xxx', ANTHROPIC_AUTH_TOKEN: 'tok' } as unknown as NodeJS.ProcessEnv;
  buildChildEnv(parent);
  assert.strictEqual(parent.ANTHROPIC_API_KEY, 'sk-xxx');
  assert.strictEqual(parent.ANTHROPIC_AUTH_TOKEN, 'tok');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
