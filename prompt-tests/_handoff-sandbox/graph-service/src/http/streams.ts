// graph-service/src/http/streams.ts — SSE broadcast of committed mutations: the write-path
// replacement for a chokidar file-watch on the dashboard side. Each route subscribes directly to
// one store's row-emission hook (`SqliteStateStore.subscribe` / `SqlitePortfolioStore.subscribe`)
// and reflects every committed row to the client as it lands — no polling, no second read of the
// database. A Hono sub-router mounted at the app root by `http/app.ts`, since both routes' full
// paths (`/engine-graph/stream`, `/work-graph/stream`) sit alongside — but outside — the
// read/write sub-routers in `engine-graph.ts`/`work-graph.ts`.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { GraphService } from '../compose.js';
import { err } from './respond.js';

/** Builds the SSE sub-router, closed over `service` — every handler reaches state exclusively
 * through it, never a module-level singleton. Mounted onto the main app by `http/app.ts` via
 * `app.route('/', buildStreamRouter(service))`. */
export function buildStreamRouter(service: GraphService): Hono {
  const app = new Hono();

  // GET /engine-graph/stream?project=<id> — subscribes to the execution store's row-emission
  // hook and filters to the requested project; every other project's rows are dropped here, not
  // in the store (D10 draws the opposite scope for the portfolio stream below).
  app.get('/engine-graph/stream', (c) => {
    const project = c.req.query('project');
    if (!project) return c.json(err('invalid_request', "'project' is required"), 400);

    return streamSSE(c, async (stream) => {
      const unsubscribe = service.execStore.subscribe((row) => {
        if (row.project_id !== project) return;
        // Fire-and-forget: the store's emit loop is synchronous, so a slow or already-dead
        // subscriber must never block it — a write against an aborted stream is dropped, not
        // thrown. Payloads pass node-type `data` through unread (core-opacity).
        void stream.writeSSE({ data: JSON.stringify(row), event: 'change', id: String(row.seq) }).catch(() => {});
      });
      // The callback must stay pending until the client disconnects — `streamSSE` closes the
      // stream as soon as this promise settles, so resolution is deferred to `onAbort`.
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
    });
  });

  // GET /work-graph/stream — subscribes to the portfolio store's row-emission hook, broadcasting
  // every committed row with no per-project filter (D10: the portfolio graph is global scope).
  app.get('/work-graph/stream', (c) => {
    return streamSSE(c, async (stream) => {
      const unsubscribe = service.portfolio.subscribe((row) => {
        void stream.writeSSE({ data: JSON.stringify(row), event: 'change', id: String(row.seq) }).catch(() => {});
      });
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
    });
  });

  return app;
}
