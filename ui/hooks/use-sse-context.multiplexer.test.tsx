import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { defaultSSEContextValue, fanOut } from './use-sse-context';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'use-sse-context.tsx'), 'utf-8');

let passed = 0, failed = 0;
async function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}

async function run() {
  await test('context value exposes a subscribe function (FR-11, AD-4)', () => {
    assert.strictEqual(typeof (defaultSSEContextValue as unknown as Record<string, unknown>).subscribe, 'function',
      'default context must expose a no-op subscribe');
  });
  await test('default subscribe returns an unsubscribe function (FR-11, AD-4)', () => {
    const sub = (defaultSSEContextValue as { subscribe: (fn: (e: unknown) => void) => () => void }).subscribe;
    const off = sub(() => {});
    assert.strictEqual(typeof off, 'function', 'subscribe must return an unsubscribe function');
    assert.doesNotThrow(() => off());
  });
  await test('provider owns one EventSource via useSSE onEvent fan-out, not statusOnly (FR-11, NFR-1)', () => {
    assert.ok(src.includes('useSSE('), 'provider must drive its EventSource through useSSE');
    assert.ok(!/statusOnly:\s*true/.test(src), 'provider must no longer run statusOnly (it now needs payloads)');
    assert.ok(src.includes('onEvent'), 'provider must pass onEvent to fan events to subscribers');
  });
  await test('provider still exposes sseStatus and reconnect (FR-11, FR-13, AD-4)', () => {
    assert.strictEqual((defaultSSEContextValue as unknown as Record<string, unknown>).sseStatus, 'disconnected');
    assert.strictEqual(typeof (defaultSSEContextValue as unknown as Record<string, unknown>).reconnect, 'function');
  });
  await test('fanOut isolates a throwing subscriber so siblings still receive the event (multiplexer robustness)', () => {
    const calls: string[] = [];
    const listeners = [
      () => { calls.push('a'); },
      () => { throw new Error('boom'); },
      () => { calls.push('c'); },
    ];
    const origErr = console.error;
    console.error = () => {}; // silence the expected isolation log
    try {
      assert.doesNotThrow(() => fanOut(listeners, { type: 'connected', payload: {} } as never),
        'a throwing listener must not bubble out of fanOut into the EventSource callback');
    } finally {
      console.error = origErr;
    }
    assert.deepStrictEqual(calls, ['a', 'c'], 'the throwing listener must not starve its siblings');
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
run();
