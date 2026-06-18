import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { runClaudeTurn } from './run-claude-turn';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(
  join(__dirname, '..', '..', 'app', 'api', 'brainstorm-poc', 'route.ts'),
  'utf-8',
);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}

interface Captured { command?: string; options?: { shell: boolean; cwd: string; env: NodeJS.ProcessEnv; windowsHide?: boolean }; stdin?: string; }

// A minimal fake of child_process.spawn: collects stdin, then emits the canned
// JSON on stdout and closes cleanly.
function makeFakeSpawn(captured: Captured, response: object) {
  return (command: string, options: Captured['options']) => {
    captured.command = command;
    captured.options = options;
    const child = new EventEmitter() as unknown as {
      stdout: EventEmitter; stderr: EventEmitter;
      stdin: { write: (s: string) => void; end: () => void };
      on: EventEmitter['on'];
    };
    (child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
    (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
    let buf = '';
    (child as unknown as { stdin: { write: (s: string) => void; end: () => void } }).stdin = {
      write: (s: string) => { buf += s; },
      end: () => {
        captured.stdin = buf;
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify(response)));
          (child as unknown as EventEmitter).emit('close', 0);
        });
      },
    };
    return child;
  };
}

const MINT = '99999999-8888-4777-8666-555555555555';

async function run() {
  console.log('runClaudeTurn');

  await test('first turn creates with --session-id, strips key, hides the window, returns reply', async () => {
    const captured: Captured = {};
    const spawnFn = makeFakeSpawn(captured, { result: 'pong', session_id: MINT });
    const out = await runClaudeTurn(
      { message: 'ping', sessionId: MINT, resume: false },
      { spawnFn: spawnFn as never, env: { ANTHROPIC_API_KEY: 'sk-xxx', PATH: '/x' }, cwd: '/work' },
    );
    assert.strictEqual(out.reply, 'pong');
    assert.strictEqual(out.sessionId, MINT);
    assert.ok(captured.command!.includes(`--session-id ${MINT}`));
    assert.ok(!captured.command!.includes('--resume'));
    // normal session: no safe-mode, no tool-off, auto permission mode
    assert.ok(!captured.command!.includes('--safe-mode'));
    assert.ok(!captured.command!.includes('--tools'));
    assert.ok(captured.command!.includes('--permission-mode auto'));
    assert.strictEqual(captured.stdin, 'ping');
    assert.strictEqual(captured.options!.shell, true);
    assert.strictEqual(captured.options!.cwd, '/work');
    assert.strictEqual(captured.options!.env.ANTHROPIC_API_KEY, undefined);
    assert.strictEqual(captured.options!.windowsHide, true);
  });

  await test('a resume turn continues the session with --resume', async () => {
    const captured: Captured = {};
    const spawnFn = makeFakeSpawn(captured, { result: 'again', session_id: MINT });
    await runClaudeTurn(
      { message: 'more', sessionId: MINT, resume: true },
      { spawnFn: spawnFn as never, env: {}, cwd: '/work' },
    );
    assert.ok(captured.command!.includes(`--resume ${MINT}`));
    assert.ok(!captured.command!.includes('--session-id'));
  });

  await test('a pasted id is resumed verbatim and the returned id is adopted (portability probe)', async () => {
    const captured: Captured = {};
    const spawnFn = makeFakeSpawn(captured, { result: 'hijacked', session_id: 'ext' });
    const out = await runClaudeTurn(
      { message: 'who am i', sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', resume: true },
      { spawnFn: spawnFn as never, env: {}, cwd: '/work' },
    );
    assert.ok(captured.command!.includes('--resume aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
    assert.strictEqual(out.reply, 'hijacked');
    assert.strictEqual(out.sessionId, 'ext');
  });

  await test('the route validates the session id and wires the stateless runner', () => {
    assert.ok(routeSource.includes('runClaudeTurn'));
    assert.ok(routeSource.includes('isValidSessionId'));
    assert.ok(routeSource.includes('resume'));
    // the agent runs rooted at the hardcoded orchestration workspace, not the server cwd
    assert.ok(routeSource.includes('orchestration'));
    assert.ok(!routeSource.includes('process.cwd()'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
