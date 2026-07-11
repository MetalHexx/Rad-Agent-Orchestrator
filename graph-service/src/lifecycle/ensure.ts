// graph-service/src/lifecycle/ensure.ts — the idempotent "guarantee a running daemon" entry
// point: `ensure()` reuses a healthy daemon on the warm path and spawns exactly one (via an
// exclusive-create lockfile race) on the cold path; `status()` is the read-only report over the
// same probe. Neither ever guesses a port — the winner's `service.json` is the one source both a
// winner and a loser return through.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lockFilePath,
  readDiscoveryFile,
  resolveRadorcRoot,
  type ServiceDiscovery,
} from './discovery.js';

const DEFAULT_PORT = 1336;

const HEALTH_PROBE_TIMEOUT_MS = 500;
const SPAWN_POLL_INTERVAL_MS = 100;
const SPAWN_POLL_TIMEOUT_MS = 10_000;
const LOCK_WAIT_POLL_INTERVAL_MS = 100;
const LOCK_WAIT_TIMEOUT_MS = 10_000;

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

interface HealthInfo {
  readonly service?: string;
  readonly engine?: string;
  readonly pid?: number;
}

/** Probes `{url}/health`, returning the envelope's `data` on a healthy `{ ok: true }` reply and
 *  `null` on anything else (network error, timeout, non-2xx, or `{ ok: false }`) — every caller
 *  treats "not confirmably healthy" the same way, as "no daemon here". */
export async function probeHealth(url: string, timeoutMs: number, fetchImpl: FetchFn = fetch): Promise<HealthInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${url}/health`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; data?: unknown };
    if (body.ok !== true) return null;
    return (body.data ?? {}) as HealthInfo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface LiveEndpoint {
  readonly endpoint: string;
  readonly port: number;
  readonly pid: number;
}

async function probeExisting(root: string, fetchImpl: FetchFn, timeoutMs: number): Promise<LiveEndpoint | null> {
  const entry = await readDiscoveryFile(root);
  if (!entry) return null;
  const health = await probeHealth(entry.url, timeoutMs, fetchImpl);
  if (!health) return null;
  return { endpoint: entry.url, port: entry.port, pid: entry.pid };
}

async function waitForHealthy(
  root: string,
  fetchImpl: FetchFn,
  probeTimeoutMs: number,
  pollIntervalMs: number,
  boundMs: number,
  now: () => number,
  sleep: SleepFn,
): Promise<LiveEndpoint | null> {
  const deadline = now() + boundMs;
  do {
    const found = await probeExisting(root, fetchImpl, probeTimeoutMs);
    if (found) return found;
    await sleep(pollIntervalMs);
  } while (now() < deadline);
  return null;
}

/** Exclusive-create the lockfile (`service.lock`); `false` (not thrown) on `EEXIST` — the normal
 *  "someone else already holds it" outcome a racing `ensure()` call is expected to hit. */
async function tryAcquireLock(lockPath: string): Promise<boolean> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    await handle.close();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** The default spawn target: this package's own compiled daemon entrypoint, resolved relative to
 *  this module rather than baked in — `dist/lifecycle/ensure.js` sits next to `dist/bin/serve.js`. */
function defaultServeScriptPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'serve.js');
}

export interface EnsureOptions {
  readonly root?: string;
  /** Requested port; the daemon may fall back to the next free one — always read the winner's
   *  actual port back from its `service.json`, never assume this value bound. */
  readonly port?: number;
  readonly dbPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly probeTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly pollTimeoutMs?: number;
  readonly lockWaitTimeoutMs?: number;
  readonly _fetch?: FetchFn;
  readonly _spawn?: SpawnFn;
  readonly _sleep?: SleepFn;
  readonly _now?: () => number;
}

export interface EnsureResult {
  /** `true` only for the call that actually spawned the daemon; a warm reuse and a lock loser
   *  both report `false`. */
  readonly spawned: boolean;
  readonly endpoint: string;
  readonly port: number;
  readonly pid: number;
}

/**
 * Idempotent, fast: reuses a healthy daemon on the warm path with no spawn at all; on the cold
 * path, exactly one racing caller wins an exclusive-create lockfile, spawns the daemon detached,
 * and polls `/health` until it's green (bounded timeout); every other caller waits on the same
 * probe and returns the winner's endpoint once it appears.
 */
export async function ensure(opts: EnsureOptions = {}): Promise<EnsureResult> {
  const root = opts.root ?? resolveRadorcRoot();
  const fetchImpl = opts._fetch ?? fetch;
  const spawnImpl: SpawnFn = opts._spawn ?? nodeSpawn;
  const sleep = opts._sleep ?? defaultSleep;
  const now = opts._now ?? Date.now;
  const probeTimeoutMs = opts.probeTimeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? SPAWN_POLL_INTERVAL_MS;
  const pollTimeoutMs = opts.pollTimeoutMs ?? SPAWN_POLL_TIMEOUT_MS;
  const lockWaitTimeoutMs = opts.lockWaitTimeoutMs ?? LOCK_WAIT_TIMEOUT_MS;

  const warm = await probeExisting(root, fetchImpl, probeTimeoutMs);
  if (warm) return { spawned: false, ...warm };

  const lockPath = lockFilePath(root);
  const acquired = await tryAcquireLock(lockPath);
  if (!acquired) {
    const winner = await waitForHealthy(root, fetchImpl, probeTimeoutMs, LOCK_WAIT_POLL_INTERVAL_MS, lockWaitTimeoutMs, now, sleep);
    if (!winner) {
      throw new Error(`timed out waiting for another process to start the graph-service daemon under ${root}`);
    }
    return { spawned: false, ...winner };
  }

  try {
    // Double-check: the winner of the previous race may have finished spawning between our
    // initial probe and acquiring the lock.
    const recheck = await probeExisting(root, fetchImpl, probeTimeoutMs);
    if (recheck) return { spawned: false, ...recheck };

    const requestedPort = opts.port ?? DEFAULT_PORT;
    const dbPath = opts.dbPath ?? ':memory:';
    const command = opts.command ?? process.execPath;
    const args = opts.args ?? [defaultServeScriptPath()];
    const child = spawnImpl(command, args, {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ...opts.env,
        GRAPH_SERVICE_PORT: String(requestedPort),
        GRAPH_SERVICE_DB_PATH: dbPath,
      },
    });
    child.unref();

    const started = await waitForHealthy(root, fetchImpl, probeTimeoutMs, pollIntervalMs, pollTimeoutMs, now, sleep);
    if (!started) {
      throw new Error(`graph-service daemon did not become healthy within ${pollTimeoutMs}ms under ${root}`);
    }
    return { spawned: true, ...started };
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}

export interface StatusOptions {
  readonly root?: string;
  readonly probeTimeoutMs?: number;
  readonly _fetch?: FetchFn;
}

export interface StatusResult {
  readonly running: boolean;
  readonly endpoint?: string;
  readonly pid?: number;
  readonly port?: number;
  readonly version?: string;
}

/** Read-only report: probes `/health` off whatever `service.json` names, never spawns or mutates
 *  anything — `ensure()` owns the spawn decision, this just answers "is it up?". */
export async function status(opts: StatusOptions = {}): Promise<StatusResult> {
  const root = opts.root ?? resolveRadorcRoot();
  const fetchImpl = opts._fetch ?? fetch;
  const probeTimeoutMs = opts.probeTimeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;

  const entry = await readDiscoveryFile(root);
  if (!entry) return { running: false };
  const health = await probeHealth(entry.url, probeTimeoutMs, fetchImpl);
  if (!health) return { running: false };
  return {
    running: true,
    endpoint: entry.url,
    pid: entry.pid,
    port: entry.port,
    version: health.service,
  };
}

export type { ServiceDiscovery };
