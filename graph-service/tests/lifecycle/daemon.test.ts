import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDiscoveryFile, writeDiscoveryFile } from '../../src/lifecycle/discovery.js';
import { start, stop } from '../../src/lifecycle/daemon.js';
import { populateBuiltinNodeTypes } from '../../src/node-types/populate-builtin.js';

const EXAMPLE_PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/example');

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-daemon-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function stageCustomPackage(nodeTypesRoot: string, pkgDirName: string, sourceDir: string): Promise<void> {
  const dest = path.join(nodeTypesRoot, 'custom', pkgDirName);
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(sourceDir, dest, { recursive: true });
}

describe('start', () => {
  it('binds loopback-only on an ephemeral port and writes a matching discovery file', async () => {
    await populateBuiltinNodeTypes(root);
    const result = await start({ port: 0, dbPath: ':memory:', root, signals: [] });
    try {
      expect(result.port).toBeGreaterThan(0);
      expect(result.url).toBe(`http://127.0.0.1:${result.port}`);

      const res = await fetch(`${result.url}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data: { pid: number } };
      expect(body.ok).toBe(true);
      expect(body.data.pid).toBe(process.pid);

      await expect(readDiscoveryFile(root)).resolves.toEqual({
        pid: process.pid,
        port: result.port,
        url: result.url,
        startedAt: expect.any(String),
      });
    } finally {
      await new Promise<void>((resolve) => result.server.close(() => resolve()));
      result.service.db.close();
    }
  });

  it('falls back to the next free port on a bind collision and records the actual port', async () => {
    const rootA = path.join(root, 'a');
    const rootB = path.join(root, 'b');
    await populateBuiltinNodeTypes(rootA);
    await populateBuiltinNodeTypes(rootB);
    const first = await start({ port: 0, dbPath: ':memory:', root: rootA, signals: [] });
    try {
      const second = await start({ port: first.port, dbPath: ':memory:', root: rootB, signals: [] });
      try {
        expect(second.port).toBeGreaterThan(first.port);
        await expect(readDiscoveryFile(rootB)).resolves.toMatchObject({ port: second.port });
      } finally {
        await new Promise<void>((resolve) => second.server.close(() => resolve()));
        second.service.db.close();
      }
    } finally {
      await new Promise<void>((resolve) => first.server.close(() => resolve()));
      first.service.db.close();
    }
  });

  it('scans <root>/node-types, resolving a discovered custom type through the composed registry', async () => {
    await populateBuiltinNodeTypes(root);
    await stageCustomPackage(path.join(root, 'node-types'), 'example', EXAMPLE_PACKAGE_DIR);

    const result = await start({ port: 0, dbPath: ':memory:', root, signals: [] });
    try {
      expect(result.service.registry.resolve('example:greet')).toBeDefined();
    } finally {
      await new Promise<void>((resolve) => result.server.close(() => resolve()));
      result.service.db.close();
    }
  });

  it('refuses to boot when a custom node-type package fails to load', async () => {
    const nodeTypesRoot = path.join(root, 'node-types');
    const brokenDir = path.join(nodeTypesRoot, 'custom', 'broken');
    await fs.mkdir(brokenDir, { recursive: true });
    await fs.writeFile(
      path.join(brokenDir, 'manifest.yml'),
      'namespace: broken\nversion: "1.0.0"\ndescription: "test fixture"\nnodeTypes:\n  - name: broken:thing\n    entrypoint: ./thing.js\n',
      'utf8',
    );
    await fs.writeFile(path.join(brokenDir, 'thing.js'), "throw new Error('boom');\n", 'utf8');

    await expect(start({ port: 0, dbPath: ':memory:', root, signals: [] })).rejects.toThrow(/broken/);
  });

  it('refuses to boot type-less when the node-types tree yields no built-ins', async () => {
    // An absent (or built-in-less) node-types tree is a hard startup error now, not a silent
    // type-less boot: the daemon has nothing to compile templates or drive nodes against.
    await expect(start({ port: 0, dbPath: ':memory:', root, signals: [] })).rejects.toThrow(
      /no built-in node types discovered/,
    );
  });

  it('threads root and projectRoot onto the composed service as two distinct directories, exactly as passed', async () => {
    // Mirrors the functional-test harness's own convention (`tests/harness/boot.ts`): `root` and
    // `projectRoot` are deliberately different directories — the live risk this must never collapse.
    await populateBuiltinNodeTypes(root);
    const projectRoot = path.join(root, 'project');
    const result = await start({ port: 0, dbPath: ':memory:', root, projectRoot, signals: [] });
    try {
      expect(result.service.root).toBe(root);
      expect(result.service.projectRoot).toBe(projectRoot);
      expect(result.service.root).not.toBe(result.service.projectRoot);
    } finally {
      await new Promise<void>((resolve) => result.server.close(() => resolve()));
      result.service.db.close();
    }
  });
});

describe('graceful shutdown', () => {
  it('on SIGTERM: drains the server, closes the db, removes the discovery file, then exits', async () => {
    const exitSpy = vi.fn();
    await populateBuiltinNodeTypes(root);
    const result = await start({ port: 0, dbPath: ':memory:', root, _exit: exitSpy });

    process.emit('SIGTERM');

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
    await expect(readDiscoveryFile(root)).resolves.toBeNull();
    await expect(fetch(`${result.url}/health`)).rejects.toThrow();
  });
});

describe('stop', () => {
  it('reports stopped when there is no discovery file to act on', async () => {
    await expect(stop({ root })).resolves.toEqual({ stopped: true });
  });

  it('signals a real process and clears the discovery file', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    try {
      await writeDiscoveryFile(
        { pid: child.pid!, port: 1, url: 'http://127.0.0.1:1', startedAt: new Date().toISOString() },
        root,
      );

      const result = await stop({ root, pollIntervalMs: 5, pollTimeoutMs: 200, probeTimeoutMs: 50 });

      expect(result).toEqual({ stopped: true, pid: child.pid });
      await expect(readDiscoveryFile(root)).resolves.toBeNull();
      await vi.waitFor(() => {
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      });
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('reports stopped: false and keeps the discovery file when the daemon is still healthy at the poll timeout', async () => {
    // A real child process stands in for a live daemon pid (so `process.kill` succeeds rather than
    // hitting the "already dead" branch), but health is faked via `_fetch` — on Windows,
    // `process.kill(pid, 'SIGTERM')` terminates the target unconditionally (there's no real signal
    // delivery to ignore), so a live process can't itself simulate "still draining" across
    // platforms. Faking the probe isolates the poll-timeout branch from that platform difference.
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    try {
      const url = 'http://127.0.0.1:1';
      await writeDiscoveryFile({ pid: child.pid!, port: 1, url, startedAt: new Date().toISOString() }, root);

      const alwaysHealthy: typeof fetch = (() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 }))) as typeof fetch;

      const result = await stop({
        root,
        pollIntervalMs: 5,
        pollTimeoutMs: 50,
        probeTimeoutMs: 20,
        _fetch: alwaysHealthy,
      });

      expect(result).toEqual({ stopped: false, pid: child.pid });
      await expect(readDiscoveryFile(root)).resolves.toMatchObject({ pid: child.pid, port: 1, url });
    } finally {
      child.kill('SIGKILL');
    }
  });
});
