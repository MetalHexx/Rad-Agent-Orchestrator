// graph-service/tests/harness/boot.ts
//
// Boots a real graph-service daemon — the actual `compose()` + `buildApp()` + `serve()` stack this
// package ships — on an ephemeral loopback port over a temp on-disk SQLite file, via P03's own
// `start()` (the same in-process convention `tests/lifecycle/daemon.test.ts` already proves: a
// real HTTP bind, a real SQLite file, a custom `root` so `service.json` never collides with any
// real daemon on the machine, `signals: []` so this test process's own signal handling is
// untouched). Every functional scenario drives the result exclusively over HTTP (`drive.ts`);
// nothing outside this module reaches into the daemon's internals once it's up.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { start } from '../../src/lifecycle/daemon.js';
import type { StartResult } from '../../src/lifecycle/daemon.js';

export interface BootedDaemon {
  /** The daemon's current base URL. Re-read this after `restart()` — a fresh bind may land on a different ephemeral port. */
  baseUrl(): string;
  /** The on-disk SQLite file this daemon (and any `restart()`) opens — stable across a restart. */
  readonly dbPath: string;
  /** Abruptly tears down the server + closes the DB handle — no graceful SIGINT/SIGTERM handshake — simulating a hard kill mid-run. */
  kill(): Promise<void>;
  /** Kills the current daemon (if still alive) and boots a fresh one over the *same* `dbPath` — a fresh `compose()`, a fresh ephemeral port — proving restart durability. */
  restart(): Promise<void>;
  /** Kills the daemon (if alive) and removes the temp root. Always safe to call more than once — the guaranteed teardown every scenario runs in its `afterEach`. */
  teardown(): Promise<void>;
}

/** Boots a fresh daemon into its own temp root: a fresh temp directory plus a SQLite file inside it, bound to an OS-assigned ephemeral port. */
export async function bootDaemon(): Promise<BootedDaemon> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-functional-'));
  const dbPath = path.join(root, 'graph.sqlite');

  let current: StartResult | undefined;
  let alive = false;

  async function boot(): Promise<void> {
    current = await start({ port: 0, dbPath, root, signals: [] });
    alive = true;
  }

  async function kill(): Promise<void> {
    if (!alive || !current) return;
    const { server, service } = current;
    alive = false;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    service.db.close();
  }

  await boot();

  return {
    baseUrl(): string {
      if (!current) throw new Error('boot: daemon is not running');
      return current.url;
    },
    dbPath,
    kill,
    async restart(): Promise<void> {
      await kill();
      await boot();
    },
    async teardown(): Promise<void> {
      await kill();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
