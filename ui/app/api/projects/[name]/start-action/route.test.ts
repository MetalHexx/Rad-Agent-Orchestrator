import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { NextRequest } from 'next/server';
import { withHomedir } from '../../../../../lib/test-helpers.js';
import { POST } from './route.js';

const VALID_YAML = `version: "4"
limits:
  max_retries_per_task: 2
human_gates:
  after_planning: true
  execution_mode: ask
  after_final_review: true
source_control:
  auto_commit: always
  auto_pr: ask
`;

async function seedHome(): Promise<{ tmp: string }> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'start-action-'));
  const radorcDir = path.join(tmp, '.radorc');
  await mkdir(radorcDir, { recursive: true });
  await writeFile(path.join(radorcDir, 'orchestration.yml'), VALID_YAML, 'utf-8');
  await mkdir(path.join(radorcDir, 'projects', 'DEMO-PROJECT'), { recursive: true });
  return { tmp };
}

interface SpawnRecord {
  cmd: string;
  args: string[];
}

/** Intercepts the real `child_process.spawn` so no test spawns a real terminal. */
function stubSpawn(): { calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = [];
  mock.method(child_process, 'spawn', (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    return child as unknown as child_process.ChildProcess;
  });
  return { calls };
}

/**
 * Decodes the inner command the library built, keyed off the host's actual
 * platform (the route never overrides `launchTerminal`'s platform option).
 * Mirrors the decode idiom in lib/terminal-launch/tests/launch.test.ts.
 */
function deliveredPayload(calls: SpawnRecord[], index = 0): string {
  const args = calls[index]!.args;
  const platform = process.platform;
  if (platform === 'win32') {
    const idx = args.indexOf('-EncodedCommand');
    if (idx === -1) return '';
    const encoded = args[idx + 1] ?? '';
    return Buffer.from(encoded, 'base64').toString('utf16le');
  }
  if (platform === 'darwin') {
    const idx = args.indexOf('-e');
    return args[idx + 1] ?? '';
  }
  const dashDash = args.indexOf('--');
  const cIdx = args.indexOf('-c', dashDash);
  return args[cIdx + 1] ?? '';
}

function jsonRequest(body: unknown, name: string): NextRequest {
  return {
    json: async () => body,
    headers: new Headers(),
    nextUrl: new URL(`http://localhost/api/projects/${name}/start-action`),
  } as unknown as NextRequest;
}

function invokePOST(body: unknown, name: string) {
  return POST(jsonRequest(body, name), { params: { name } });
}

afterEach(() => {
  mock.restoreAll();
});

test('POST returns 404 for an unknown project', async () => {
  const { tmp } = await seedHome();
  try {
    await withHomedir(tmp, async () => {
      const res = await invokePOST({ action: 'start-brainstorming' }, 'NOPE');
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.match(json.error, /not found/i);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST returns 400 for an invalid project name format', async () => {
  const res = await invokePOST({ action: 'start-brainstorming' }, 'bad..name');
  assert.equal(res.status, 400);
});

test('POST returns 400 for an unknown action', async () => {
  const { tmp } = await seedHome();
  try {
    await withHomedir(tmp, async () => {
      const res = await invokePOST({ action: 'nope' }, 'DEMO-PROJECT');
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /action/i);
      assert.match(json.error, /execute-plan/);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

for (const action of ['start-brainstorming', 'start-planning', 'execute-plan'] as const) {
  test(`POST ${action} happy path returns 200 { success: true, platform } and fires exactly one spawn attempt`, async () => {
    const { tmp } = await seedHome();
    const { calls } = stubSpawn();
    try {
      await withHomedir(tmp, async () => {
        const res = await invokePOST({ action }, 'DEMO-PROJECT');
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(typeof json.platform, 'string');
        assert.equal(calls.length, 1);
      });
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
}

test('POST composes the /rad-execute prompt and reaches the launcher with claude --permission-mode auto and no --add-dir/--model', async () => {
  const { tmp } = await seedHome();
  const { calls } = stubSpawn();
  try {
    await withHomedir(tmp, async () => {
      const res = await invokePOST({ action: 'execute-plan' }, 'DEMO-PROJECT');
      assert.equal(res.status, 200);
      const payload = deliveredPayload(calls);
      assert.match(payload, /claude/);
      assert.match(payload, /--permission-mode/);
      assert.match(payload, /auto/);
      assert.match(payload, /\/rad-execute DEMO-PROJECT/);
      assert.doesNotMatch(payload, /--add-dir/);
      assert.doesNotMatch(payload, /--model/);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST composes the brainstorming/planning prompts unchanged from before the swap', async () => {
  const { tmp } = await seedHome();
  try {
    await withHomedir(tmp, async () => {
      {
        const { calls } = stubSpawn();
        await invokePOST({ action: 'start-brainstorming' }, 'DEMO-PROJECT');
        assert.match(deliveredPayload(calls), /\/rad-brainstorm DEMO-PROJECT/);
      }
      mock.restoreAll();
      {
        const { calls } = stubSpawn();
        await invokePOST({ action: 'start-planning' }, 'DEMO-PROJECT');
        assert.match(deliveredPayload(calls), /\/rad-plan Start planning DEMO-PROJECT/);
      }
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST returns 500 with a structured error and no path/env leakage when the projects directory cannot be enumerated', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'start-action-empty-'));
  try {
    await withHomedir(tmp, async () => {
      const res = await invokePOST({ action: 'start-brainstorming' }, 'DEMO-PROJECT');
      assert.equal(res.status, 500);
      const json = await res.json();
      assert.ok(typeof json.error === 'string');
      assert.ok(!/[A-Z]:\\|\/home\//.test(json.error), 'error must not echo absolute host path');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST returns 500 with a sanitized message, no path leakage, when the launch directory no longer exists', async () => {
  const { tmp } = await seedHome();
  // Forces launchTerminal's own pre-spawn cwd check to fail, so the route's
  // fixed `~/.radorc` cwd is reported missing even though seedHome() created
  // it — exercising the one launcher error shape that names the cwd.
  mock.method(fs, 'existsSync', () => false);
  try {
    await withHomedir(tmp, async () => {
      const res = await invokePOST({ action: 'start-brainstorming' }, 'DEMO-PROJECT');
      assert.equal(res.status, 500);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error, 'Launch directory no longer exists.');
      assert.ok(!/[A-Z]:\\|\/home\//.test(json.error), 'error must not echo absolute host path');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST returns 500 with the launcher error, no path/env leakage, on a forced launch failure', async () => {
  const { tmp } = await seedHome();
  mock.method(child_process, 'spawn', () => {
    throw new Error('Forced failure for testing.');
  });
  try {
    await withHomedir(tmp, async () => {
      const res = await invokePOST({ action: 'start-brainstorming' }, 'DEMO-PROJECT');
      assert.equal(res.status, 500);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(typeof json.error, 'string');
      assert.ok(!/[A-Z]:\\|\/home\//.test(json.error), 'error must not echo absolute host path');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
