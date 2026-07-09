// graph-service/src/http/app.ts — builds the Hono app the daemon serves: `/health`, plus the
// envelope-shaped not-found/error fallbacks every later route inherits.
import { Hono } from 'hono';
import type { GraphService } from '../compose.js';
import { err, ok } from './respond.js';

interface HealthPayload {
  readonly service: string;
  readonly engine: string;
  readonly dbPath: string;
  readonly user_version: number;
  readonly pid: number;
  readonly uptimeMs: number;
}

/** Builds the Hono app closed over `service` — every handler reaches state through this one object. */
export function buildApp(service: GraphService): Hono {
  const app = new Hono();

  app.get('/health', (c) => {
    const payload: HealthPayload = {
      service: service.version.service,
      engine: service.version.engine,
      dbPath: service.dbPath,
      user_version: service.db.pragma('user_version', { simple: true }) as number,
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
    };
    return c.json(ok(payload));
  });

  app.notFound((c) => c.json(err('not_found', `no route for ${c.req.method} ${c.req.path}`), 404));

  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : String(error);
    return c.json(err('internal_error', message), 500);
  });

  return app;
}
