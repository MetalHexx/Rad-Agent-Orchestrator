// graph-service/tests/harness/boot.ts
//
// Boots a real graph-service daemon — the actual `compose()` + `buildApp()` + `serve()` stack this
// package ships — on an ephemeral loopback port over a temp on-disk SQLite file, via P03's own
// `start()` (the same in-process convention `tests/lifecycle/daemon.test.ts` already proves: a
// real HTTP bind, a real SQLite file, a custom `root` so `service.json` never collides with any
// real daemon on the machine, `signals: []` so this test process's own signal handling is
// untouched). Every functional scenario drives the result exclusively over HTTP (`drive.ts`);
// nothing outside this module reaches into the daemon's internals once it's up.
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import { start } from '../../src/lifecycle/daemon.js';
import type { StartResult } from '../../src/lifecycle/daemon.js';
import { populateBuiltinNodeTypes } from '../../src/node-types/populate-builtin.js';

export interface BootDaemonOptions {
  /**
   * Called once, after the temp `root` is created but before the first `start()` runs its
   * node-type scan — the hook a seed-from-disk scenario uses to pre-stage a custom node-type
   * package under `<root>/node-types/` so the daemon's own scan discovers it.
   */
  readonly stageNodeTypes?: (root: string) => Promise<void> | void;
}

export interface BootedDaemon {
  /** The daemon's current base URL. Re-read this after `restart()` — a fresh bind may land on a different ephemeral port. */
  baseUrl(): string;
  /** The on-disk SQLite file this daemon (and any `restart()`) opens — stable across a restart. */
  readonly dbPath: string;
  /**
   * Stages `content` at `path`, resolved against the daemon's real `projectRoot` — the black-box
   * way a scenario stages a review/audit report the service's own resolver reads its verdict off
   * via the real `docRead` port, since nothing in the HTTP surface writes agent-authored docs. A
   * genuine on-disk write, so it survives a `restart()` unchanged.
   */
  seedDoc(path: string, content: string): void;
  /**
   * Reads back `path` (resolved the same way `seedDoc` writes it) — the black-box way a scenario
   * asserts content the service itself wrote via the real `docWrite` port (e.g. `explosion`'s
   * emitted phase/task docs, or a re-explode's backup copy). `null` if nothing exists there yet.
   */
  readDoc(path: string): string | null;
  /**
   * Lists the immediate entries under `dirPath` (resolved the same way `seedDoc`/`readDoc` are) —
   * `[]` if the directory doesn't exist. Lets a scenario discover a dynamically real-clock-stamped
   * path (e.g. `explosion`'s own `backups/{stamp}/`) without predicting the stamp itself.
   */
  listDir(dirPath: string): readonly string[];
  /** Abruptly tears down the server + closes the DB handle — no graceful SIGINT/SIGTERM handshake — simulating a hard kill mid-run. */
  kill(): Promise<void>;
  /** Kills the current daemon (if still alive) and boots a fresh one over the *same* `dbPath` — a fresh `compose()`, a fresh ephemeral port — proving restart durability. */
  restart(): Promise<void>;
  /** Kills the daemon (if alive) and removes the temp root. Always safe to call more than once — the guaranteed teardown every scenario runs in its `afterEach`. */
  teardown(): Promise<void>;
}

/** Boots a fresh daemon into its own temp root: a fresh temp directory holding the SQLite file, the
 * discovery-file root, and a `project/` subdirectory the real `docRead`/`docWrite` ports confine to
 * — bound to an OS-assigned ephemeral port. `options.stageNodeTypes`, if supplied, runs once against
 * that temp root before the first `start()` call, ahead of its node-type scan. */
export async function bootDaemon(options: BootDaemonOptions = {}): Promise<BootedDaemon> {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'graph-service-functional-'));
  const dbPath = nodePath.join(root, 'graph.sqlite');
  const projectRoot = nodePath.join(root, 'project');
  await fs.mkdir(projectRoot, { recursive: true });

  // The daemon's `start()` now refuses to boot type-less, so every functional daemon needs the
  // `builtin/` bucket staged on disk before its first scan — the same dev-seed staging the real
  // seed path runs (`populateBuiltinNodeTypes`).
  await populateBuiltinNodeTypes(root);

  if (options.stageNodeTypes) {
    await options.stageNodeTypes(root);
  }

  let current: StartResult | undefined;
  let alive = false;

  async function boot(): Promise<void> {
    current = await start({ port: 0, dbPath, root, projectRoot, signals: [] });
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
    seedDoc(path: string, content: string): void {
      if (!current) throw new Error('boot: daemon is not running');
      const target = nodePath.resolve(projectRoot, path);
      fsSync.mkdirSync(nodePath.dirname(target), { recursive: true });
      fsSync.writeFileSync(target, content, 'utf8');
    },
    readDoc(path: string): string | null {
      if (!current) throw new Error('boot: daemon is not running');
      const target = nodePath.resolve(projectRoot, path);
      try {
        return fsSync.readFileSync(target, 'utf8');
      } catch {
        return null;
      }
    },
    listDir(dirPath: string): readonly string[] {
      if (!current) throw new Error('boot: daemon is not running');
      const target = nodePath.resolve(projectRoot, dirPath);
      try {
        return fsSync.readdirSync(target);
      } catch {
        return [];
      }
    },
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
