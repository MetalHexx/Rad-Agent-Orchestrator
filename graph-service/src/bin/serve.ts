#!/usr/bin/env node
// graph-service/src/bin/serve.ts — the daemon entrypoint: resolve config, compose the services
// object, and serve it. Lifecycle/discovery (config file, port allocation, PID files, …) is P03 —
// this reads a hardcoded/env-driven port and DB path only.
import { serve } from '@hono/node-server';
import { compose } from '../compose.js';
import { buildApp } from '../http/app.js';

const DEFAULT_PORT = 4600;

const dbPath = process.env['GRAPH_SERVICE_DB_PATH'] ?? ':memory:';
const port = Number(process.env['GRAPH_SERVICE_PORT'] ?? DEFAULT_PORT);

const service = compose({ dbPath });
const app = buildApp(service);

// Loopback-only: the daemon never binds beyond 127.0.0.1.
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`graph-service listening on http://127.0.0.1:${info.port} (db=${dbPath})`);
});
