import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeDiscoveryFile } from '../../src/lifecycle/discovery.js';
import { ensure, status } from '../../src/lifecycle/ensure.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-ensure-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** A fetch stub that reports `/health` as green for every URL, tagging the response with `pid`
 *  so a test can tell which "daemon" answered without a real socket. */
function healthyFetch(pid: number): typeof fetch {
  return (async () =>
    ({
      ok: true,
      json: async () => ({ ok: true, data: { service: 'graph-service', engine: 'test', pid } }),
    }) as unknown as Response) as unknown as typeof fetch;
}

function fakeChild(pid: number): ChildProcess {
  return { pid, unref: () => undefined } as unknown as ChildProcess;
}

describe('ensure — warm path', () => {
  it('reuses a healthy service.json with no spawn', async () => {
    await writeDiscoveryFile({ pid: 111, port: 1336, url: 'http://127.0.0.1:1336', startedAt: new Date().toISOString() }, root);
    const spawnSpy = vi.fn();

    const result = await ensure({ root, _fetch: healthyFetch(111), _spawn: spawnSpy });

    expect(result).toEqual({ spawned: false, endpoint: 'http://127.0.0.1:1336', port: 1336, pid: 111 });
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});

describe('ensure — cold path', () => {
  it('acquires the lock, spawns exactly once, and polls until healthy', async () => {
    const spawnSpy = vi.fn(() => {
      // Simulates the winner's daemon finishing its own start() a beat after being spawned.
      void writeDiscoveryFile(
        { pid: 222, port: 1400, url: 'http://127.0.0.1:1400', startedAt: new Date().toISOString() },
        root,
      );
      return fakeChild(222);
    });

    const result = await ensure({
      root,
      port: 1336,
      _fetch: healthyFetch(222),
      _spawn: spawnSpy,
      pollIntervalMs: 5,
      pollTimeoutMs: 2000,
    });

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ spawned: true, endpoint: 'http://127.0.0.1:1400', port: 1400, pid: 222 });

    const [command, args] = spawnSpy.mock.calls[0]!;
    expect(typeof command).toBe('string');
    expect(Array.isArray(args)).toBe(true);
  });

  it('throws if the daemon never becomes healthy within the bound', async () => {
    const spawnSpy = vi.fn(() => fakeChild(333)); // never writes a discovery file

    await expect(
      ensure({ root, _fetch: healthyFetch(333), _spawn: spawnSpy, pollIntervalMs: 5, pollTimeoutMs: 30 }),
    ).rejects.toThrow(/did not become healthy/);
  });
});

describe('ensure — concurrent race', () => {
  it('two concurrent ensures spawn exactly one daemon and agree on its endpoint', async () => {
    const spawnSpy = vi.fn(() => {
      void writeDiscoveryFile(
        { pid: 444, port: 1500, url: 'http://127.0.0.1:1500', startedAt: new Date().toISOString() },
        root,
      );
      return fakeChild(444);
    });
    const fetchImpl = healthyFetch(444);
    const commonOpts = { root, _fetch: fetchImpl, _spawn: spawnSpy, pollIntervalMs: 5, pollTimeoutMs: 2000, lockWaitTimeoutMs: 2000 };

    const [a, b] = await Promise.all([ensure(commonOpts), ensure(commonOpts)]);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(a.endpoint).toBe(b.endpoint);
    expect(a.pid).toBe(b.pid);
    expect(a.port).toBe(b.port);
    // Exactly one of the two racers is the one that actually spawned.
    expect([a.spawned, b.spawned].filter(Boolean)).toHaveLength(1);
  });
});

describe('status', () => {
  it('reports running/endpoint/version from a health probe', async () => {
    await writeDiscoveryFile({ pid: 555, port: 1336, url: 'http://127.0.0.1:1336', startedAt: new Date().toISOString() }, root);

    const result = await status({ root, _fetch: healthyFetch(555) });

    expect(result).toEqual({ running: true, endpoint: 'http://127.0.0.1:1336', pid: 555, port: 1336, version: 'graph-service' });
  });

  it('reports not running when there is no discovery file', async () => {
    await expect(status({ root })).resolves.toEqual({ running: false });
  });

  it('reports not running when the recorded daemon does not answer', async () => {
    await writeDiscoveryFile({ pid: 666, port: 1336, url: 'http://127.0.0.1:1336', startedAt: new Date().toISOString() }, root);
    const deadFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(status({ root, _fetch: deadFetch })).resolves.toEqual({ running: false });
  });
});
