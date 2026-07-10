// graph-service/src/lifecycle/daemon.ts — the daemon process's own half of the lifecycle:
// `start()` composes the service, binds the HTTP surface (loopback-only, with the documented
// port fallback), writes `service.json`, and installs the graceful-shutdown handler; `stop()` is
// the caller-side half — it reads `service.json` and signals the pid it names. `start()` runs
// inside the (possibly detached) daemon process itself; `ensure.ts` owns spawning that process.
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { compose } from '../compose.js';
import type { GraphService } from '../compose.js';
import { buildApp } from '../http/app.js';
import {
  readDiscoveryFile,
  removeDiscoveryFile,
  resolveRadorcRoot,
  writeDiscoveryFile,
} from './discovery.js';
import { probeHealth } from './ensure.js';

const LOOPBACK_HOST = '127.0.0.1';
// A generous but bounded walk forward from the requested port — enough to step past a handful of
// collisions without looping forever if the whole range happens to be taken.
const MAX_PORT_FALLBACK_ATTEMPTS = 20;

function isAddrInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
}

/**
 * Binds `serve()` to `startPort`, walking forward one port at a time on `EADDRINUSE` (up to
 * `MAX_PORT_FALLBACK_ATTEMPTS`) — the actual bound port is whatever the caller records in
 * `service.json`, so a client never has to assume the requested port held.
 */
function bindWithFallback(
  fetchHandler: Parameters<typeof serve>[0]['fetch'],
  hostname: string,
  startPort: number,
): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryBind = (port: number): void => {
      const server: ServerType = serve({ fetch: fetchHandler, hostname, port }, (info) => {
        server.off('error', onError);
        resolve({ server, port: info.port });
      });
      const onError = (error: unknown): void => {
        server.off('error', onError);
        if (isAddrInUse(error) && attempt < MAX_PORT_FALLBACK_ATTEMPTS) {
          attempt += 1;
          server.close(() => tryBind(port + 1));
          return;
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      server.on('error', onError);
    };

    tryBind(startPort);
  });
}

export interface StartOptions {
  readonly port: number;
  readonly dbPath: string;
  readonly root?: string;
  readonly hostname?: string;
  readonly signals?: readonly NodeJS.Signals[];
  readonly _exit?: (code: number) => void;
}

export interface StartResult {
  readonly server: ServerType;
  readonly service: GraphService;
  readonly port: number;
  readonly url: string;
}

/**
 * Starts the daemon: binds loopback-only (falling back off a port collision), writes the
 * discovery file, and installs the `SIGINT`/`SIGTERM` graceful-shutdown handler — drain the HTTP
 * server, close the DB handle, remove `service.json`, then exit, so a restart always finds a
 * clean slate.
 */
export async function start(opts: StartOptions): Promise<StartResult> {
  const root = opts.root ?? resolveRadorcRoot();
  const hostname = opts.hostname ?? LOOPBACK_HOST;
  const service = compose({ dbPath: opts.dbPath });
  const app = buildApp(service);

  const { server, port } = await bindWithFallback(app.fetch, hostname, opts.port);
  const url = `http://${hostname}:${port}`;

  await writeDiscoveryFile({ pid: process.pid, port, url, startedAt: new Date().toISOString() }, root);

  const exit = opts._exit ?? ((code: number) => process.exit(code));
  const signals: readonly NodeJS.Signals[] = opts.signals ?? ['SIGINT', 'SIGTERM'];
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {
      service.db.close();
      void removeDiscoveryFile(root).finally(() => exit(0));
    });
  };
  for (const signal of signals) {
    process.once(signal, shutdown);
  }

  return { server, service, port, url };
}

const STOP_POLL_INTERVAL_MS = 100;
const STOP_POLL_TIMEOUT_MS = 5_000;
const STOP_PROBE_TIMEOUT_MS = 500;

export interface StopOptions {
  readonly root?: string;
  readonly pollIntervalMs?: number;
  readonly pollTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  readonly _fetch?: typeof fetch;
  readonly _sleep?: (ms: number) => Promise<void>;
  readonly _now?: () => number;
}

export interface StopResult {
  readonly stopped: true;
  readonly pid?: number;
}

/**
 * Signals the daemon named by `service.json`: `SIGTERM`, then poll `/health` until it stops
 * answering (or a bounded timeout elapses). Reports `stopped: true` even when no daemon was on
 * record — "no daemon running" is already the goal state. Always clears `service.json` on the
 * way out as a best-effort backstop for a daemon that died without running its own shutdown
 * handler (e.g. `SIGKILL`, a crash).
 */
export async function stop(opts: StopOptions = {}): Promise<StopResult> {
  const root = opts.root ?? resolveRadorcRoot();
  const entry = await readDiscoveryFile(root);
  if (!entry) return { stopped: true };

  try {
    process.kill(entry.pid, 'SIGTERM');
  } catch {
    // Already dead — nothing to wait on.
    await removeDiscoveryFile(root);
    return { stopped: true, pid: entry.pid };
  }

  const fetchImpl = opts._fetch ?? fetch;
  const sleep = opts._sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts._now ?? Date.now;
  const pollIntervalMs = opts.pollIntervalMs ?? STOP_POLL_INTERVAL_MS;
  const pollTimeoutMs = opts.pollTimeoutMs ?? STOP_POLL_TIMEOUT_MS;
  const probeTimeoutMs = opts.probeTimeoutMs ?? STOP_PROBE_TIMEOUT_MS;

  const deadline = now() + pollTimeoutMs;
  while (now() < deadline) {
    const health = await probeHealth(entry.url, probeTimeoutMs, fetchImpl);
    if (!health) break;
    await sleep(pollIntervalMs);
  }

  await removeDiscoveryFile(root);
  return { stopped: true, pid: entry.pid };
}
