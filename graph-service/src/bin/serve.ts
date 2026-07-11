#!/usr/bin/env node
// graph-service/src/bin/serve.ts — the daemon entrypoint: resolves the requested port/DB from
// env and hands off to `start()` (bind + serve + signal handlers + discovery-file write). This
// is exactly what `ensure()`'s detached spawn invokes; it's also runnable directly for manual/dev
// use.
import { start } from '../lifecycle/daemon.js';

// 1336 is the locked default (the service's neighbor, the dashboard, is 1337); `ensure()` may
// request a different one, and a bind collision falls back to the next free port regardless —
// the daemon's own `service.json` write is the only source of truth for what actually bound.
const DEFAULT_PORT = 1336;

const dbPath = process.env['GRAPH_SERVICE_DB_PATH'] ?? ':memory:';
const port = Number(process.env['GRAPH_SERVICE_PORT'] ?? DEFAULT_PORT);

start({ port, dbPath })
  .then(({ url }) => {
    console.log(`graph-service listening on ${url} (db=${dbPath})`);
  })
  .catch((error: unknown) => {
    console.error('graph-service failed to start:', error);
    process.exit(1);
  });
