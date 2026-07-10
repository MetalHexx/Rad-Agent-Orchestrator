import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDiscoveryFile, writeDiscoveryFile } from '../../src/lifecycle/discovery.js';
import { start, stop } from '../../src/lifecycle/daemon.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-daemon-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('start', () => {
  it('binds loopback-only on an ephemeral port and writes a matching discovery file', async () => {
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
});

describe('graceful shutdown', () => {
  it('on SIGTERM: drains the server, closes the db, removes the discovery file, then exits', async () => {
    const exitSpy = vi.fn();
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
});
