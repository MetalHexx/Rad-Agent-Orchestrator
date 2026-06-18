import assert from 'node:assert';
import { resolveTurn, isValidSessionId, mintFreshSession, type SessionState } from './session-logic';
import { buildClaudeCommand } from './claude-command';
import { buildChildEnv } from './child-env';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}

const FIXED = '11111111-2222-4333-8444-555555555555';
const mint = () => FIXED;

console.log('brainstorm-poc helpers');

test('fresh state mints a session and marks the first turn', () => {
  const r = resolveTurn({ sessionId: null, established: false }, undefined, mint);
  assert.strictEqual(r.sessionId, FIXED);
  assert.strictEqual(r.isFirstTurn, true);
  assert.deepStrictEqual(r.nextState, { sessionId: FIXED, established: true });
});

test('an established session resumes and is not a first turn', () => {
  const state: SessionState = { sessionId: 'abc', established: true };
  const r = resolveTurn(state, undefined, mint);
  assert.strictEqual(r.sessionId, 'abc');
  assert.strictEqual(r.isFirstTurn, false);
});

test('a client-supplied id is resumed verbatim (hijack probe)', () => {
  const r = resolveTurn({ sessionId: 'mine', established: true }, '  external-id  ', mint);
  assert.strictEqual(r.sessionId, 'external-id');
  assert.strictEqual(r.isFirstTurn, false);
  assert.deepStrictEqual(r.nextState, { sessionId: 'external-id', established: true });
});

test('isValidSessionId accepts a UUID and rejects junk / injection', () => {
  assert.strictEqual(isValidSessionId(FIXED), true);
  assert.strictEqual(isValidSessionId('not-a-uuid'), false);
  assert.strictEqual(isValidSessionId('x" && rm -rf /'), false);
});

test('mintFreshSession returns a new, not-yet-established session', () => {
  const r = mintFreshSession(mint);
  assert.strictEqual(r.sessionId, FIXED);
  assert.deepStrictEqual(r.nextState, { sessionId: FIXED, established: false });
});

test('first-turn command creates with --session-id, vanilla and tool-off', () => {
  const cmd = buildClaudeCommand({ sessionId: FIXED, isFirstTurn: true });
  assert.ok(cmd.startsWith('claude -p '));
  assert.ok(cmd.includes(`--session-id ${FIXED}`));
  assert.ok(!cmd.includes('--resume'));
  assert.ok(cmd.includes('--safe-mode'));
  assert.ok(cmd.includes('--tools ""'));
  assert.ok(cmd.includes('--output-format json'));
});

test('later-turn command resumes and never re-mints', () => {
  const cmd = buildClaudeCommand({ sessionId: FIXED, isFirstTurn: false });
  assert.ok(cmd.includes(`--resume ${FIXED}`));
  assert.ok(!cmd.includes('--session-id'));
});

test('buildChildEnv strips ANTHROPIC_API_KEY and keeps the rest', () => {
  const env = buildChildEnv({ ANTHROPIC_API_KEY: 'sk-xxx', PATH: '/usr/bin', FOO: 'bar' });
  assert.strictEqual(env.ANTHROPIC_API_KEY, undefined);
  assert.strictEqual(env.PATH, '/usr/bin');
  assert.strictEqual(env.FOO, 'bar');
});

test('buildChildEnv does not mutate the parent env', () => {
  const parent = { ANTHROPIC_API_KEY: 'sk-xxx' };
  buildChildEnv(parent);
  assert.strictEqual(parent.ANTHROPIC_API_KEY, 'sk-xxx');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
